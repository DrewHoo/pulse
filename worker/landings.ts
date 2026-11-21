import { countBy, groupBy, maxBy, sumBy, uniq } from 'es-toolkit';
import { quantile, SESSION_MINUTES } from './measures';
import type { Address } from './names';
import { QUICK_SECONDS, STAYED_SECONDS, STAYED_TAPS } from './thresholds';
import { localMidnight } from './time';
import { addressesOf, visitOf, visitsByBrowser, type SiteEvent } from './visitors';

// The landings screen: where the last seven days' visits landed and how far
// they went, counted from the same days of Mixpanel's raw export the other two
// screens read. specs/landings.spec.md holds the rules, in "The words" and
// "Starred pages".
//
// Everything here reads what a `leave` reports and where a visit's page views
// were. Nothing names a site or an event of one.

/** Pages alike but for one segment read as one starred row from this many. */
export const ALIKE_PAGES = 4;
/** A landing row lists this many of its sources and of its events. */
export const SOURCES_LISTED = 3;
export const EVENTS_LISTED = 6;
/** The seconds added up count one visit at this most: a tab left in view for hours isn't a day's reading. */
export const SECONDS_COUNTED = SESSION_MINUTES * 60;

const DAYS = 7;

// ---------------------------------------------------------------------------
// A visit, as the counts read it
// ---------------------------------------------------------------------------

/** One visit, reduced to what the counts read. */
export interface CountedVisit {
  device: string;
  start: number;     // UTC milliseconds
  source: string;
  landing: Address;
  measured: boolean; // a `leave` reported on it, so its seconds and taps are known
  seconds: number;
  taps: number;
  pages: number;     // its distinct pages
  path: Address[];   // its pages in order, without a repeat of the page before
  events: string[];  // the names of its events, beside the page view and the leave
}

const samePage = (a: Address, b: Address) => a.site === b.site && a.page === b.page;

/** Every visit in browsers' events, oldest first within a browser. */
export function countedVisits(events: SiteEvent[], pageview: string): CountedVisit[] {
  return visitsByBrowser(events, pageview).flatMap(({ device, visits }) => visits.map((ofVisit): CountedVisit => {
    const visit = visitOf(ofVisit, pageview);
    const path = addressesOf(ofVisit, pageview).filter((a, i, all) => i === 0 || !samePage(a, all[i - 1]!));
    return {
      device, start: visit.start, source: visit.source, landing: visit.landing,
      measured: visit.scroll !== null, seconds: visit.seconds, taps: visit.taps,
      pages: visit.pages.length, path, events: visit.eventTotals.map((e) => e.name),
    };
  }));
}

export const isQuick = (v: CountedVisit) => v.measured && v.seconds < QUICK_SECONDS && v.pages === 1 && v.taps === 0;
export const hasStayed = (v: CountedVisit) =>
  v.measured && (v.pages > 1 || v.seconds >= STAYED_SECONDS || v.taps >= STAYED_TAPS);

/** What a set of visits did. Quick and stayed are counts of the measured visits. */
export interface Counts {
  visits: number;
  visitors: number;
  measured: number;
  quick: number;
  stayed: number;
  median: number | null; // seconds in view, the measured visits' median; null with none measured
  seconds: number;       // seconds in view, the measured visits' added up, each SECONDS_COUNTED at most
  pagesAVisit: number;   // the mean, to one decimal
}

export function countsOf(visits: CountedVisit[]): Counts {
  const measured = visits.filter((v) => v.measured);
  return {
    visits: visits.length,
    visitors: uniq(visits.map((v) => v.device)).length,
    measured: measured.length,
    quick: measured.filter(isQuick).length,
    stayed: measured.filter(hasStayed).length,
    median: quantile(measured.map((v) => v.seconds).sort((a, b) => a - b), 0.5),
    seconds: sumBy(measured, (v) => Math.min(v.seconds, SECONDS_COUNTED)),
    pagesAVisit: visits.length === 0 ? 0 : Math.round((sumBy(visits, (v) => v.pages) / visits.length) * 10) / 10,
  };
}

// ---------------------------------------------------------------------------
// Starred pages
// ---------------------------------------------------------------------------

/**
 * Each page of one site as its row reads: itself, or with a `*` at the one
 * segment that ALIKE_PAGES or more of the pages differ in ("/coach/*"). If two
 * segments qualify, the one with more pages
 * wins, then the earlier. A page with one segment is never starred: a site's
 * named pages differ in one segment, and each is a page of its own.
 */
export function starredPages(pages: string[]): Map<string, string> {
  const distinct = uniq(pages);
  const starredAt = (page: string) => {
    const segments = page.split('/'); // "/coach/x" is ["", "coach", "x"]
    if (segments.length < 3) return [];
    return segments.slice(1).map((_, i) => segments.map((s, at) => (at === i + 1 ? '*' : s)).join('/'));
  };
  const alike = countBy(distinct.flatMap(starredAt), (starred) => starred);
  return new Map(distinct.map((page) => {
    const most = maxBy(starredAt(page), (starred) => alike[starred]!);
    return [page, most !== undefined && alike[most]! >= ALIKE_PAGES ? most : page];
  }));
}

// ---------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------

export interface SiteRow extends Counts { site: string }
export interface SourceRow extends Counts { source: string; site: string }

/** A page under a starred row. */
export interface PageUnder extends Counts { page: string; href: string }

/** The visits that landed on one page of one site, or on its pages alike but for one segment. */
export interface LandingRow extends Counts {
  site: string;
  page: string;        // "/coach/lane-kiffin", or starred: "/coach/*"
  href: string | null; // the page's address without its query; null for a starred page
  under: PageUnder[];  // a starred page's pages, the most visits first; empty for a page
  sources: { source: string; visits: number }[];           // the SOURCES_LISTED biggest
  next: { site: string; page: string; visitors: number }[]; // the first other page its visits saw, starred
  stopped: number;     // its visits that saw no other page
  events: { name: string; visits: number; stayed: number }[]; // the measured visits that sent each, and those of them that stayed
}

export interface Landings {
  v: 1;
  fetchedAt: string;
  from: number;          // the window's start, UTC milliseconds: midnight six days ago in the project's timezone
  sites: SiteRow[];      // the most visits first
  sources: SourceRow[];  // a source and the site it sent visits to, the most visits first
  landings: LandingRow[];
  staleSince?: string | null; // set by index.ts when a day's events are the last good copy
}

const byVisits = <T extends Counts>(rows: T[], name: (row: T) => string) =>
  rows.sort((a, b) => b.visits - a.visits || name(a).localeCompare(name(b)));

// The page's address as a link: where it is, without the state a visit left it in.
function withoutQuery(href: string): string {
  try { const url = new URL(href); return `${url.origin}${url.pathname}`; } catch { return href; }
}

function landingRows(visits: CountedVisit[]): LandingRow[] {
  const seen = visits.flatMap((v) => v.path);
  const starsOf = new Map(Object.entries(groupBy(seen, (a) => a.site)).map(([site, on]) => [site, starredPages(on.map((a) => a.page))]));
  const starred = (a: Address) => starsOf.get(a.site)?.get(a.page) ?? a.page;

  const rows = Object.values(groupBy(visits, (v) => `${v.landing.site}\n${starred(v.landing)}`)).map((landed): LandingRow => {
    const { site } = landed[0]!.landing;
    const page = starred(landed[0]!.landing);
    const isStarred = page !== landed[0]!.landing.page;
    const under = Object.values(groupBy(landed, (v) => v.landing.page)).map((on): PageUnder => ({
      page: on[0]!.landing.page, href: withoutQuery(on[0]!.landing.href), ...countsOf(on),
    }));

    const went = landed.map((v) => ({ device: v.device, to: v.path.find((a) => !samePage(a, v.landing)) }));
    const moved = went.filter((w): w is { device: string; to: Address } => w.to !== undefined);
    const next = Object.values(groupBy(moved, (w) => `${w.to.site}\n${starred(w.to)}`)).map((to) => ({
      site: to[0]!.to.site, page: starred(to[0]!.to), visitors: uniq(to.map((w) => w.device)).length,
    }));

    const measured = landed.filter((v) => v.measured);
    const names = uniq(measured.flatMap((v) => v.events));
    const events = names.map((name) => {
      const sent = measured.filter((v) => v.events.includes(name));
      return { name, visits: sent.length, stayed: sent.filter(hasStayed).length };
    });

    return {
      site, page,
      href: isStarred ? null : withoutQuery(landed[0]!.landing.href),
      ...countsOf(landed),
      under: isStarred ? byVisits(under, (u) => u.page) : [],
      sources: Object.entries(countBy(landed, (v) => v.source)).map(([source, n]) => ({ source, visits: n }))
        .sort((a, b) => b.visits - a.visits || a.source.localeCompare(b.source)).slice(0, SOURCES_LISTED),
      next: next.sort((a, b) => b.visitors - a.visitors || a.page.localeCompare(b.page)),
      stopped: landed.length - moved.length,
      events: events.sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name)).slice(0, EVENTS_LISTED),
    };
  });
  return byVisits(rows, (row) => `${row.site}\n${row.page}`);
}

/**
 * Browsers' events reaching numbers.ts's WEEK_HOURS back, as the landings
 * screen's answer: the visits that started since the midnight six days ago in
 * `tz`, counted by site, by source and by the page they landed on.
 */
export function landingsOf(events: SiteEvent[], pageview: string, tz: string, now: Date = new Date()): Landings {
  const from = localMidnight(tz, now, DAYS - 1);
  const visits = countedVisits(events, pageview).filter((v) => v.start >= from);
  const sites = Object.values(groupBy(visits, (v) => v.landing.site))
    .map((on): SiteRow => ({ site: on[0]!.landing.site, ...countsOf(on) }));
  const sources = Object.values(groupBy(visits, (v) => `${v.source}\n${v.landing.site}`))
    .map((sent): SourceRow => ({ source: sent[0]!.source, site: sent[0]!.landing.site, ...countsOf(sent) }));
  return {
    v: 1,
    fetchedAt: now.toISOString(),
    from,
    sites: byVisits(sites, (row) => row.site),
    sources: byVisits(sources, (row) => `${row.source}\n${row.site}`),
    landings: landingRows(visits),
  };
}
