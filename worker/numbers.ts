import { groupBy, uniq } from 'es-toolkit';
import { sourceName } from './names';
import {
  aiName, INTERNAL, outsideName, pageName, pathUrl, rank, sportName,
  type PathKey, type Returning, type Row, type Stats,
} from './shape';
import { addDays, localHours, type LocalNow } from './time';
import type { SiteEvent } from './visitors';

// The numbers screen, counted from the raw export's days (the same cached
// days the visitors screen reads), so a filter costs no Mixpanel call. Until
// 2026-11-17 each filter was fifteen Query API calls a refresh, and the
// screen alone spent most of the project's sixty an hour.
//
// A count of visitors is distinct `$device_id`s, where the Query API counted
// distinct ids; for a reader who never signs in they are the same browser.

/**
 * How far back the numbers read: from the project-local midnight six days
 * ago, which is at most seven days back, and an hour more for a clock change.
 */
export const WEEK_HOURS = 7 * 24 + 1;

/** The parts the export can't hold: the link previews are a bot's events, and the three numbers read 56 days. */
export type FromQueries = Pick<Stats, 'shares' | 'measures' | 'redditLandings'> & { redditLinks: Stats['reddit']['links'] };

/** A page view, with the project-local day and hour it fell in. */
interface View { date: string; hour: number; device: string; event: SiteEvent }

const visitorCount = (views: View[]) => uniq(views.map((v) => v.device)).length;

/** A list's rows: each name's views today and this week, and its visitors today. A view `nameOf` gives no name is left out. */
function rowsOf(views: View[], today: string, nameOf: (e: SiteEvent) => string): Row[] {
  const named = groupBy(views.filter((v) => nameOf(v.event) !== ''), (v) => nameOf(v.event));
  return Object.entries(named).map(([name, ofName]) => {
    const todays = ofName.filter((v) => v.date === today);
    return { name, today: todays.length, visitors: visitorCount(todays), week: ofName.length };
  });
}

/** Views and visitors in each hour of one day. */
function hourly(views: View[], date: string) {
  const byHour = groupBy(views.filter((v) => v.date === date), (v) => v.hour);
  const each = (count: (vs: View[]) => number) => Array.from({ length: 24 }, (_, h) => count(byHour[h] ?? []));
  return { views: each((vs) => vs.length), visitors: each(visitorCount) };
}

const hostOf = (href?: string) => { try { return href ? new URL(href).hostname : ''; } catch { return ''; } };

/** A referrer as the Referrers list names it: Drew's own sites by domain, any other by its URL. */
function referrerName(e: SiteEvent): string {
  if (!e.referrer || e.referrer.startsWith('$')) return '(direct)';
  const host = hostOf(e.referrer).replace(/^www\./, '');
  return INTERNAL.includes(host) ? host : outsideName(e.referrer);
}

/** An assistant's tag if the view carries one, else its referrer's host. */
const assistantName = (e: SiteEvent) => aiName(e.utmSource ?? hostOf(e.referrer));

const pathOf = (href: string) => { try { return new URL(href).pathname; } catch { return 'undefined'; } };

/** Who came back: today's visitors seen on an earlier day this week, and the week's visitors seen on two or more days. */
function returningOf(views: View[], today: string): Returning {
  const daysOf = Object.values(groupBy(views, (v) => v.device)).map((ofDevice) => uniq(ofDevice.map((v) => v.date)));
  return {
    today: daysOf.filter((days) => days.includes(today) && days.length > 1).length,
    week: daysOf.filter((days) => days.length > 1).length,
    weekVisitors: daysOf.length,
  };
}

/**
 * The numbers screen's answer from browsers' events reaching WEEK_HOURS back,
 * cut to the filter's pages, with what the Query API answered beside it.
 */
export function numbersOf(
  events: SiteEvent[], pageview: string, now: LocalNow, path: PathKey, fromQueries: FromQueries, fetchedAt: Date = new Date(),
): Stats {
  const url = pathUrl(path);
  const weekStart = addDays(now.date, -6);
  const yesterdayDate = addDays(now.date, -1);
  const local = localHours(now.tz);
  const views: View[] = events
    .filter((e) => e.name === pageview && (!url || e.url.includes(url)))
    .map((e) => ({ ...local(e.at), device: e.device, event: e }))
    .filter((v) => v.date >= weekStart && v.date <= now.date);

  const today = hourly(views, now.date);
  const yesterday = hourly(views, yesterdayDate);
  const cut = <T,>(xs: T[]) => xs.map((n, h) => (h <= now.hour ? n : null));
  const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);
  const byDay = groupBy(views, (v) => v.date);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
    .map((date) => ({ date, n: byDay[date]?.length ?? 0, visitors: visitorCount(byDay[date] ?? []) }));
  const rows = (nameOf: (e: SiteEvent) => string) => rowsOf(views, now.date, nameOf);
  const [redditRow] = rows((e) => (sourceName(e.referrer) === 'reddit' ? 'reddit' : ''));

  return {
    v: 5,
    path,
    fetchedAt: fetchedAt.toISOString(),
    tz: now.tz,
    date: now.date,
    hour: now.hour,
    minute: now.minute,
    hours: { today: cut(today.views), yesterday: yesterday.views, todayVisitors: cut(today.visitors), yesterdayVisitors: yesterday.visitors },
    days,
    totals: {
      thisHour: today.views[now.hour]!,
      thisHourVisitors: today.visitors[now.hour]!,
      lastHour: now.hour > 0 ? today.views[now.hour - 1]! : yesterday.views[23]!,
      lastHourVisitors: now.hour > 0 ? today.visitors[now.hour - 1]! : yesterday.visitors[23]!,
      today: days[6]!.n,
      todayVisitors: days[6]!.visitors,
      todayVisitorHours: sum(today.visitors.slice(0, now.hour + 1)),
      yesterdayToHour: sum(yesterday.views.slice(0, now.hour + 1)),
      yesterdayVisitorHoursToHour: sum(yesterday.visitors.slice(0, now.hour + 1)),
      yesterday: days[5]!.n,
      yesterdayVisitors: days[5]!.visitors,
      week: views.length,
      weekVisitorsPerDay: Math.round(sum(days.map((d) => d.visitors)) / 7),
    },
    referrers: rank(rows(referrerName)),
    pages: rank(rows((e) => pageName(pathOf(e.url), path))),
    shares: fromQueries.shares,
    ai: rank(rows(assistantName)),
    reddit: { views: redditRow ?? { name: 'reddit', today: 0, visitors: 0, week: 0 }, links: fromQueries.redditLinks },
    returning: returningOf(views, now.date),
    sports: path === 'puttingupnumbers' ? rank(rows((e) => sportName(e.sport ?? 'undefined'))) : [],
    measures: fromQueries.measures,
    redditLandings: fromQueries.redditLandings,
  };
}
