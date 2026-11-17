import { groupBy, maxBy, sumBy, uniq, uniqBy } from 'es-toolkit';
import { RESOLVE_SECONDS, SESSION_MINUTES } from './measures';
import { addressOf, deviceName, placeName, sourceName, type Address } from './names';
import { addDays } from './time';

// The visitors screen: who was here in the last WINDOW_HOURS and what each of
// them did, shaped from Mixpanel's raw export. specs/visitors.spec.md holds
// the rules, in "The words" and "What a visit's summary holds".
//
// Everything here reads event names and property names. Nothing names a site,
// so a new site, a new event or a new property shows up with no change.

const WINDOW_HOURS = 8;
/** An arrival is new when this many hours before the window hold none like it. */
const NEW_AFTER_HOURS = 48;
/** The numbers screen lists a source's landing pages over this many days. */
export const LANDING_DAYS = 7;
/** A visit keeps this many of its events in the answer, and the count of the rest. */
export const EVENTS_KEPT = 300;

const HOUR_MS = 3_600_000;
const VISIT_GAP_MS = SESSION_MINUTES * 60_000;
const PASSING_MS = RESOLVE_SECONDS * 1000;

// The one event the summary knows by name, beside the page view: the sites
// send it as the tab hides, with the running totals for one page load.
const LEAVE = 'leave';

type Value = string | number | boolean;

// ---------------------------------------------------------------------------
// The export, read
// ---------------------------------------------------------------------------

/** One line of Mixpanel's raw export. */
export interface ExportedEvent { event: string; properties: Record<string, unknown> }

/** One event of one browser, reduced to what the screen reads. */
export interface SiteEvent {
  name: string;
  at: number;             // UTC milliseconds
  device: string;         // Mixpanel's `$device_id`: the browser
  url: string;
  site?: string;          // the embed's `site` and `sport`
  sport?: string;
  referrer?: string;
  utmSource?: string;
  firstReferrer?: string; // `$initial_referrer`: where this browser first ever came from
  city?: string;
  region?: string;
  country?: string;
  deviceName?: string;    // "iPhone", "Android"; a desktop has none
  os?: string;
  browser?: string;
  screenWidth?: number;
  screenHeight?: number;
  own: Record<string, Value>; // the event's own properties
}

// A property is the event's own when it isn't Mixpanel's and isn't one the
// embeds register on every event.
const MIXPANELS = /^(\$|mp_|current_|utm_)/;
const ON_EVERY_EVENT = new Set(['time', 'distinct_id', 'site', 'sport', 'framed', 'user_agent']);
const isOwn = (name: string) => !MIXPANELS.test(name) && !ON_EVERY_EVENT.has(name);

const text = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);
const number = (v: unknown) => (typeof v === 'number' ? v : undefined);
const value = (v: unknown): Value =>
  (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : JSON.stringify(v));

/**
 * The one place that knows Mixpanel's property names. An event with no
 * `$device_id` is the share worker's link preview, not a browser's, so it
 * isn't a visitor's.
 */
export function readEvent(e: ExportedEvent): SiteEvent | null {
  const p = e.properties;
  const device = text(p.$device_id);
  const at = number(p.time);
  if (!device || at === undefined) return null;
  const own = Object.entries(p).filter(([name, v]) => isOwn(name) && v != null).map(([name, v]) => [name, value(v)]);
  return {
    name: e.event, at, device, url: text(p.$current_url) ?? '',
    site: text(p.site), sport: text(p.sport),
    referrer: text(p.$referrer), utmSource: text(p.utm_source), firstReferrer: text(p.$initial_referrer),
    city: text(p.$city), region: text(p.$region), country: text(p.mp_country_code),
    deviceName: text(p.$device), os: text(p.$os), browser: text(p.$browser),
    screenWidth: number(p.$screen_width), screenHeight: number(p.$screen_height),
    own: Object.fromEntries(own),
  };
}

/**
 * An export's body, a JSON object a line, as browsers' events. A call over
 * several days repeats rows (3.5 times over four days on 2026-11-17), so a
 * repeat of the same event, id and `$insert_id` is dropped.
 */
export function readExport(body: string): SiteEvent[] {
  const lines = body.split('\n').filter((line) => line.trim() !== '');
  const exported = lines.map((line) => JSON.parse(line) as ExportedEvent);
  const once = uniqBy(exported, (e) => `${e.event}|${e.properties.distinct_id}|${e.properties.$insert_id}`);
  return once.map(readEvent).filter((e): e is SiteEvent => e !== null);
}

/**
 * The UTC days an answer at `now` needs to reach `hours` back, oldest first.
 * The visitors screen's reach is its window, the same hours yesterday, and
 * the days before that "new" looks back over. The export takes whole UTC
 * days, and the worker asks for one a call.
 */
export function exportDays(now: Date, hours = WINDOW_HOURS + NEW_AFTER_HOURS): string[] {
  const day = (at: number) => new Date(at).toISOString().slice(0, 10);
  const first = day(now.getTime() - hours * HOUR_MS);
  const last = day(now.getTime());
  const days = [first];
  while (days.at(-1)! < last) days.push(addDays(days.at(-1)!, 1));
  return days;
}

// ---------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------

/** A page of a visit: how often it was viewed, and each query string it was seen with. */
export interface PageSeen {
  site: string;
  page: string;
  views: number;
  states: Address[]; // one a distinct query string, the last one seen last
}

/**
 * A part of a card's pages line: a page alone, or the pages that differ only
 * in their last segment, as their parent and its children ("/coach/" and
 * "kirby-smart", "ryan-day").
 */
export interface PageGroup { path: string; children: string[]; views: number }

/**
 * A name and the distinct values it took over a visit: a query parameter (a
 * filter), or one of an event's own properties. A number that varied is one
 * value, its range.
 */
export interface NamedValues { name: string; values: string[] }

/** Every event of one name in a visit. */
export interface EventTotal {
  name: string;
  count: number;
  properties: NamedValues[];
  cardValues: string[];    // the one property a card shows: the one with the most distinct values, words before numbers
  namedForFilter: boolean; // a card leaves the event out, since the filter of its name is already on the line
}

/** A row of "All N events". */
export interface VisitEvent {
  at: number;
  name: string;
  detail: string; // a view's page and query, a leave's totals, else the event's own properties
  view?: true;    // a page view
  passing?: true; // a page view replaced within RESOLVE_SECONDS
}

/** A visitor's events with no gap of SESSION_MINUTES or more. */
export interface Visit {
  start: number;
  end: number;
  source: string;        // where it came from: "direct", "reddit", "google"
  landing: Address;      // its first page, whose site is the visit's site
  left: Address;         // its last page
  seconds: number;       // time in view: what its `leave`s reported, else its last event minus its first
  scroll: number | null; // the deepest scroll a `leave` reported, in percent; null when none came
  taps: number;
  views: number;         // page views, the passing ones among them
  passing: number;
  pages: PageSeen[];
  pageGroups: PageGroup[];
  filters: NamedValues[];
  eventTotals: EventTotal[];
  onePage: boolean;      // one page, no filter, no event
  events: VisitEvent[];  // oldest first, EVENTS_KEPT at most
  eventCount: number;
}

/** A browser, and its visits that reach into the window, latest first. */
export interface Visitor {
  id: string;
  place: string;
  device: string;
  browser: string;
  screen: string;
  firstSource: string; // where this browser first ever came from
  visits: Visit[];
}

/** A page the window's arrivals from one source landed on. */
export interface Landing extends Address { visitors: number; isNew: boolean }

/**
 * A page one source's visits landed on over LANDING_DAYS. Reddit's referrer
 * never names a thread, so a distinct landing address is the nearest thing to
 * a distinct link someone posted there.
 */
export interface SourceLanding extends Address {
  visitors: number;
  first: number;  // its first arrival and its latest, UTC milliseconds
  last: number;
  isNew: boolean; // first arrived in the last day, with none in the days before
}

/** The window's visits from one source to one site. */
export interface Arrival {
  source: string;
  site: string;
  visitors: number;
  yesterday: number; // visitors in the same hours a day earlier
  isNew: boolean;    // none like it in the NEW_AFTER_HOURS before the window
  landings: Landing[];
}

export interface Visitors {
  v: 1;
  fetchedAt: string;
  hours: number;
  visitors: Visitor[]; // latest event first
  arrivals: Arrival[];
  staleSince?: string | null; // set by index.ts when a day's events are the last good copy
}

// ---------------------------------------------------------------------------
// A visit's summary
// ---------------------------------------------------------------------------

const address = (e: SiteEvent) => addressOf(e.url, e.site, e.sport);

// Rule 1: page views grouped by page, each with its states.
function pagesOf(viewed: Address[]): PageSeen[] {
  const byPage = groupBy(viewed, (a) => `${a.site}\n${a.page}`);
  return Object.values(byPage).map((views) => {
    const lastSeenFirst = uniqBy([...views].reverse(), (a) => a.query);
    return { site: views[0]!.site, page: views[0]!.page, views: views.length, states: lastSeenFirst.reverse() };
  });
}

// Rule 2: pages under one parent read as the parent and its children.
function pageGroupsOf(pages: PageSeen[]): PageGroup[] {
  const parentOf = (page: string) => (page.lastIndexOf('/') > 0 ? page.slice(0, page.lastIndexOf('/') + 1) : '');
  // a page at the site's top has no parent, so it is a group of its own
  const groups = groupBy(pages, (p) => `${p.site}\n${parentOf(p.page) || p.page}`);
  return Object.values(groups).map((siblings) => {
    const [first] = siblings as [PageSeen, ...PageSeen[]];
    if (siblings.length === 1) return { path: first.page, children: [], views: first.views };
    const parent = parentOf(first.page);
    return { path: parent, children: siblings.map((p) => p.page.slice(parent.length)), views: sumBy(siblings, (p) => p.views) };
  });
}

function parameters(href: string): [string, string][] {
  try { return [...new URL(href).searchParams]; } catch { return []; }
}

// Slow typing leaves a value the next one extends: "Jos" before "Josh". A
// number isn't typing: min=1 before min=10 is two picks.
function withoutTyping(inOrder: string[]): string[] {
  const isNumber = (v: string) => v.trim() !== '' && !Number.isNaN(Number(v));
  const extended = (v: string, next?: string) => next !== undefined && next !== v && next.toLowerCase().startsWith(v.toLowerCase());
  return inOrder.filter((v, i) => isNumber(v) || !extended(v, inOrder[i + 1]));
}

// Rule 3: each query parameter with its distinct values. A `utm_` tag says
// where the visit came from, which is the visit's source, not a filter.
function filtersOf(viewed: Address[]): NamedValues[] {
  const picked = viewed.flatMap((a) => parameters(a.href)).filter(([name]) => !name.startsWith('utm_'));
  const byName = groupBy(picked, ([name]) => name);
  return Object.entries(byName).map(([name, pairs]) => ({
    name, values: uniq(withoutTyping(pairs.map(([, v]) => v))),
  }));
}

// A property's distinct values as the screen prints them: a number that varied is its range.
function printed(distinct: Value[]): string[] {
  const numbers = distinct.filter((v): v is number => typeof v === 'number');
  if (numbers.length > 1 && numbers.length === distinct.length) return [`${Math.min(...numbers)}–${Math.max(...numbers)}`];
  return distinct.map(String);
}

// Rule 4: every event of one name, with each own property's values. A card
// has room for one property, so it takes the one that says the most.
function eventTotalsOf(events: SiteEvent[], filters: NamedValues[]): EventTotal[] {
  const filterNames = new Set(filters.map((f) => f.name));
  const hasWords = (p: { distinct: Value[] }) => p.distinct.some((v) => typeof v === 'string');
  return Object.entries(groupBy(events, (e) => e.name)).map(([name, named]) => {
    const properties = uniq(named.flatMap((e) => Object.keys(e.own))).map((property) => ({
      name: property,
      distinct: uniq(named.map((e) => e.own[property]).filter((v): v is Value => v !== undefined)),
    }));
    const onCard = maxBy(properties.some(hasWords) ? properties.filter(hasWords) : properties, (p) => p.distinct.length);
    return {
      name, count: named.length,
      properties: properties.map((p) => ({ name: p.name, values: printed(p.distinct) })),
      cardValues: onCard ? printed(onCard.distinct) : [],
      namedForFilter: filterNames.has(name),
    };
  });
}

// Rule 6: a `leave` carries one load's running totals, so the last one for a
// load is that load's total.
function timeInView(leaves: SiteEvent[]) {
  const totals = Object.values(groupBy(leaves, (e) => String(e.own.load))).map((ofLoad) => ofLoad.at(-1)!.own);
  const read = (v: Value | undefined) => (typeof v === 'number' ? v : 0);
  return {
    seconds: sumBy(totals, (t) => read(t.seconds)),
    scroll: Math.max(...totals.map((t) => read(t.scroll))),
    taps: sumBy(totals, (t) => read(t.taps)),
  };
}

function eventRow(e: SiteEvent, pageview: string, passing: Set<SiteEvent>): VisitEvent {
  if (e.name === pageview) {
    const { page, query } = address(e);
    return { at: e.at, name: e.name, detail: query ? `${page}?${query}` : page, view: true, ...(passing.has(e) ? { passing: true as const } : {}) };
  }
  if (e.name === LEAVE && typeof e.own.seconds === 'number') {
    const taps = e.own.taps ?? 0;
    return { at: e.at, name: e.name, detail: `${e.own.seconds}s · ${e.own.scroll ?? 0}% · ${taps} ${taps === 1 ? 'tap' : 'taps'}` };
  }
  return { at: e.at, name: e.name, detail: Object.entries(e.own).map(([name, v]) => `${name}=${v}`).join(' ') };
}

// A visit's page views. One replaced within PASSING_MS is passing through:
// typing, a redirect or a glance. The rest settled.
function viewsOf(events: SiteEvent[], pageview: string) {
  const views = events.filter((e) => e.name === pageview);
  const passing = new Set(views.filter((view, i) => {
    const next = views[i + 1];
    return next !== undefined && next.at - view.at < PASSING_MS;
  }));
  return { views, passing, settled: views.filter((view) => !passing.has(view)) };
}

// The addresses a visit was at, in order. A visit with no page view of its own
// (a tab left open, reporting a leave) is on its first event's page.
const viewedOf = (events: SiteEvent[], settled: SiteEvent[]) => (settled.length > 0 ? settled : [events[0]!]).map(address);

/** One visit's events, oldest first, as the visit the screen shows. */
export function visitOf(events: SiteEvent[], pageview: string): Visit {
  const first = events[0]!;
  const last = events.at(-1)!;
  const { views, passing, settled } = viewsOf(events, pageview);
  const viewed = viewedOf(events, settled);

  const leaves = events.filter((e) => e.name === LEAVE);
  const inView = leaves.length > 0 ? timeInView(leaves) : { seconds: Math.round((last.at - first.at) / 1000), scroll: null, taps: 0 };

  const pages = pagesOf(viewed);
  const filters = filtersOf(viewed);
  const eventTotals = eventTotalsOf(events.filter((e) => e.name !== pageview && e.name !== LEAVE), filters);
  return {
    start: first.at, end: last.at,
    source: sourceName(first.referrer, first.utmSource),
    landing: viewed[0]!, left: viewed.at(-1)!,
    ...inView,
    views: views.length, passing: passing.size,
    pages, pageGroups: pageGroupsOf(pages), filters, eventTotals,
    onePage: pages.length <= 1 && filters.length === 0 && eventTotals.length === 0,
    events: events.slice(0, EVENTS_KEPT).map((e) => eventRow(e, pageview, passing)),
    eventCount: events.length,
  };
}

// ---------------------------------------------------------------------------
// Visitors and arrivals
// ---------------------------------------------------------------------------

function splitVisits(events: SiteEvent[]): SiteEvent[][] {
  const visits: SiteEvent[][] = [];
  for (const e of events) {
    const current = visits.at(-1);
    if (current && e.at - current.at(-1)!.at < VISIT_GAP_MS) current.push(e);
    else visits.push([e]);
  }
  return visits;
}

function visitorOf(events: SiteEvent[], visits: Visit[]): Visitor {
  const latest = events.at(-1)!;
  return {
    id: latest.device,
    place: placeName(latest.city, latest.region, latest.country),
    device: deviceName(latest.deviceName, latest.os),
    browser: latest.browser ?? 'unknown browser',
    screen: latest.screenWidth && latest.screenHeight ? `${latest.screenWidth}×${latest.screenHeight}` : '',
    firstSource: sourceName(latest.firstReferrer),
    visits,
  };
}

// Every browser's events in order, split into its visits.
function visitsByBrowser(events: SiteEvent[]) {
  const inOrder = [...events].sort((a, b) => a.at - b.at);
  return Object.entries(groupBy(inOrder, (e) => e.device)).map(([device, ofDevice]) => ({
    device, events: ofDevice, visits: splitVisits(ofDevice),
  }));
}

// A visit arrives when it starts: who, when, from where, and the page it landed on.
interface Arrived { device: string; start: number; source: string; landing: Address }

function arrivedOf(browsers: ReturnType<typeof visitsByBrowser>, pageview: string): Arrived[] {
  return browsers.flatMap(({ device, visits }) => visits.map((visit) => {
    const first = visit[0]!;
    return {
      device, start: first.at, source: sourceName(first.referrer, first.utmSource),
      landing: viewedOf(visit, viewsOf(visit, pageview).settled)[0]!,
    };
  }));
}

const visitorCount = (arrived: Arrived[]) => uniq(arrived.map((a) => a.device)).length;
const sourceAndSite = (a: Arrived) => `${a.source}\n${a.landing.site}`;
const landingPage = (a: Arrived) => `${a.landing.page}\n${a.landing.query}`;

// The window's arrivals by source and site, each beside the same hours yesterday.
function arrivalsOf(arrived: Arrived[], from: number, to: number): Arrival[] {
  const DAY_MS = 24 * HOUR_MS;
  const starting = (start: number, end: number) => arrived.filter((a) => a.start >= start && a.start <= end);
  const yesterday = groupBy(starting(from - DAY_MS, to - DAY_MS), sourceAndSite);
  const before = starting(from - NEW_AFTER_HOURS * HOUR_MS, from - 1);
  const seenBefore = new Set(before.map(sourceAndSite));
  const landedBefore = new Set(before.map((a) => `${sourceAndSite(a)}\n${landingPage(a)}`));

  const arrivals = Object.entries(groupBy(starting(from, to), sourceAndSite)).map(([key, group]): Arrival => {
    const landings = Object.values(groupBy(group, landingPage)).map((landed): Landing => ({
      ...landed[0]!.landing,
      visitors: visitorCount(landed),
      isNew: !landedBefore.has(`${key}\n${landingPage(landed[0]!)}`),
    }));
    return {
      source: group[0]!.source,
      site: group[0]!.landing.site,
      visitors: visitorCount(group),
      yesterday: visitorCount(yesterday[key] ?? []),
      isNew: !seenBefore.has(key),
      landings: landings.sort((a, b) => b.visitors - a.visitors || a.page.localeCompare(b.page)),
    };
  });
  return arrivals.sort((a, b) => b.visitors - a.visitors || a.source.localeCompare(b.source) || a.site.localeCompare(b.site));
}

/**
 * Browsers' events, from exportDays(now), as the screen's answer. A visitor
 * is listed with the visits that reach into the last WINDOW_HOURS.
 */
export function visitorsOf(events: SiteEvent[], pageview: string, now: Date = new Date()): Visitors {
  const to = now.getTime();
  const from = to - WINDOW_HOURS * HOUR_MS;
  const browsers = visitsByBrowser(events);
  const visitors = browsers.flatMap(({ events: ofBrowser, visits }) => {
    const inWindow = visits.filter((visit) => visit.at(-1)!.at >= from).reverse();
    return inWindow.length > 0 ? [visitorOf(ofBrowser, inWindow.map((visit) => visitOf(visit, pageview)))] : [];
  });
  return {
    v: 1,
    fetchedAt: now.toISOString(),
    hours: WINDOW_HOURS,
    visitors: visitors.sort((a, b) => b.visits[0]!.end - a.visits[0]!.end),
    arrivals: arrivalsOf(arrivedOf(browsers, pageview), from, to),
  };
}

/**
 * The addresses one source's visits landed on in the last LANDING_DAYS, from
 * the events of exportDays(now, LANDING_DAYS * 24): the most visitors first,
 * then the newest.
 */
export function landingsFrom(source: string, events: SiteEvent[], pageview: string, now: Date = new Date()): SourceLanding[] {
  const to = now.getTime();
  const from = to - LANDING_DAYS * 24 * HOUR_MS;
  const newSince = to - 24 * HOUR_MS;
  const arrived = arrivedOf(visitsByBrowser(events), pageview).filter((a) => a.source === source && a.start >= from);
  const landings = Object.values(groupBy(arrived, (a) => `${a.landing.site}\n${landingPage(a)}`)).map((landed): SourceLanding => {
    const starts = landed.map((a) => a.start);
    const first = Math.min(...starts);
    return { ...landed[0]!.landing, visitors: visitorCount(landed), first, last: Math.max(...starts), isNew: first >= newSince };
  });
  return landings.sort((a, b) => b.visitors - a.visitors || b.first - a.first);
}
