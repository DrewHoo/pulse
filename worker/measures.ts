import { REAL_JQL } from './shape';
import { addDays } from './time';

// The three numbers on Putting Up Numbers' screen (the README's "The three
// numbers" holds the definitions, and a changed definition resets the before).
// JQL sessions the events, since nothing else in Mixpanel can say what a
// visitor did first, and answers one row a day; measures() adds the days into
// windows here, so a window can change without touching the query.

// Everything a visitor can do that the numbers read, beside the pageview.
export const ACTS = ['query', 'find', 'split', 'open', 'answer'];
export const SESSION_MINUTES = 30;
export const RESOLVE_SECONDS = 2;
export const MEASURE_DAYS = 56;

export interface Tally {
  landings: number;
  hunted: number; // landings whose first act was a search or a sentence change
  acted: number;  // landings with any act
  named: number;  // the sessions' named pages, added up
}
export interface MeasureDay extends Tally { team: Tally; ms: number[] }
export type MeasureDays = Record<string, MeasureDay>;

export interface MeasureWindow extends Tally {
  team: Tally;
  answers: number;
  median: number | null; // ms
  p90: number | null;
}
export interface Measures {
  week: MeasureWindow;   // the last 7 days, today among them
  month: MeasureWindow;  // the last 28 days, today among them
  before: MeasureWindow; // the 28 days before those
}

// JQL's time is in whole seconds, so a `query` and the pageview it causes
// usually share one, and so do a builder address and the page it resolved to:
// order() puts the search or sentence change first and the builder before the
// page. A visitor's events are sorted once they're all in, since groupByUser
// hands them over in batches.
export const MEASURES_JQL = String.raw`${REAL_JQL}
var HUNT = { query: 1, find: 1, split: 1 };
function pathOf(url) {
  var m = /^https?:\/\/[^\/?#]+([^?#]*)/.exec(String(url || ''));
  return (m ? m[1].replace(/\/+$/, '') : '') || '/';
}
function isBuilder(path) { return /^\/[^\/]+\/build$/.test(path); }
function isTeam(path) { return /^\/[^\/]+\/teams\/[^\/]+$/.test(path); }
function isView(e) { return e.n === params.event; }
function order(e) { return HUNT[e.n] ? 0 : e.n === 'open' ? 1 : isBuilder(e.p) ? 2 : 3; }
function dayOf(t) { return new Date(t + params.offset).toISOString().slice(0, 10); }
function tally() { return { landings: 0, hunted: 0, acted: 0, named: 0 }; }
function dayIn(days, day) {
  var d = days[day];
  if (!d) { d = tally(); d.team = tally(); d.ms = []; days[day] = d; }
  return d;
}
function add(into, from) {
  into.landings += from.landings; into.hunted += from.hunted; into.acted += from.acted; into.named += from.named;
}
function sessionsOf(events) {
  var out = [], cur = null, last = 0;
  for (var i = 0; i < events.length; i++) {
    if (!cur || events[i].t - last >= params.sessionMs) { cur = []; out.push(cur); }
    cur.push(events[i]);
    last = events[i].t;
  }
  return out;
}
// A builder address the site resolved to a named page is the named page: the
// site's own replaceState, not a pageview of the reader's.
function withoutResolved(session) {
  return session.filter(function (e, i) {
    if (!isView(e) || !isBuilder(e.p)) return true;
    for (var j = i + 1; j < session.length; j++) {
      if (isView(session[j])) return isBuilder(session[j].p) || session[j].t - e.t > params.resolveMs;
    }
    return true;
  });
}
function count(days, session) {
  var kept = withoutResolved(session), landing = null, first = null, named = {};
  for (var i = 0; i < kept.length; i++) {
    var e = kept[i];
    if (isView(e)) {
      if (!isBuilder(e.p)) named[e.p] = 1;
      if (!landing) { landing = e; continue; }
    }
    if (!first && (!isView(e) || (landing && e.p !== landing.p))) first = e;
  }
  if (!landing) return;
  var one = { landings: 1, hunted: first && HUNT[first.n] ? 1 : 0, acted: first ? 1 : 0, named: Object.keys(named).length };
  var day = dayIn(days, dayOf(landing.t));
  add(day, one);
  if (isTeam(landing.p)) add(day.team, one);
}
function main() {
  var selectors = params.acts.concat([params.event]).map(function (event) { return { event: event }; });
  return Events({ from_date: params.from, to_date: params.to, event_selectors: selectors })
    .filter(function (e) { return real(e) && String(e.properties.$current_url || '').indexOf(params.url) >= 0; })
    .groupByUser(function (seen, events) {
      seen = seen || [];
      for (var i = 0; i < events.length; i++) {
        var e = events[i];
        seen.push({ n: e.name, t: e.time, p: pathOf(e.properties.$current_url), ms: e.properties.ms });
      }
      return seen;
    })
    .reduce(function (accs, users) {
      var days = {};
      for (var a = 0; a < accs.length; a++) {
        for (var key in accs[a]) {
          var into = dayIn(days, key), from = accs[a][key];
          add(into, from); add(into.team, from.team); into.ms = into.ms.concat(from.ms);
        }
      }
      for (var u = 0; u < users.length; u++) {
        var acts = [];
        for (var i = 0; i < users[u].value.length; i++) {
          var e = users[u].value[i];
          if (e.n !== 'answer') acts.push(e);
          else if (typeof e.ms === 'number') dayIn(days, dayOf(e.t)).ms.push(e.ms);
        }
        acts.sort(function (x, y) { return x.t - y.t || order(x) - order(y); });
        var sessions = sessionsOf(acts);
        for (var s = 0; s < sessions.length; s++) count(days, sessions[s]);
      }
      return days;
    });
}`;

const tally = (): Tally => ({ landings: 0, hunted: 0, acted: 0, named: 0 });
const add = (into: Tally, from: Tally) => {
  into.landings += from.landings; into.hunted += from.hunted; into.acted += from.acted; into.named += from.named;
};

// The value a share `q` of the sorted list sits at, the middle of the two for
// an even list's median.
export function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const at = (sorted.length - 1) * q;
  const lo = sorted[Math.floor(at)]!;
  const hi = sorted[Math.ceil(at)]!;
  return Math.round(lo + (hi - lo) * (at - Math.floor(at)));
}

function windowOf(days: MeasureDays, from: string, to: string): MeasureWindow {
  const total = tally();
  const team = tally();
  const ms: number[] = [];
  for (const [date, day] of Object.entries(days)) {
    if (date < from || date > to) continue;
    add(total, day);
    add(team, day.team);
    ms.push(...day.ms);
  }
  ms.sort((a, b) => a - b);
  return { ...total, team, answers: ms.length, median: quantile(ms, 0.5), p90: quantile(ms, 0.9) };
}

export function measures(days: MeasureDays, today: string): Measures {
  return {
    week: windowOf(days, addDays(today, -6), today),
    month: windowOf(days, addDays(today, -27), today),
    before: windowOf(days, addDays(today, -55), addDays(today, -28)),
  };
}
