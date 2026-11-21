import { describe, expect, it } from 'vitest';
import {
  ALIKE_PAGES, countedVisits, countsOf, hasStayed, isQuick, landingsOf, SECONDS_COUNTED, starredPages, type CountedVisit,
} from './landings';
import type { SiteEvent } from './visitors';

const VIEW = '$mp_web_page_view';
const HT = 'https://drewhoover.com/hostile-territory';
const PUN = 'https://puttingupnumbers.com/cfb';
const NOW = new Date('2026-11-20T20:00:00Z'); // 3 pm in New York
const TZ = 'America/New_York';
const HOUR_MS = 3_600_000;

// Each visit is its own browser's, an hour after the one before, so no two run together.
let visitsMade = 0;
interface Made { device?: string; daysAgo?: number; source?: Partial<SiteEvent>; base?: string; site?: string; sport?: string }

/**
 * One visit: its pages in order, 20 seconds apart, then what its `leave`
 * reported, or no `leave` at all. `sent` names the events it sent on its first page.
 */
function visit(pages: string[], left: { seconds: number; taps?: number } | null, sent: string[] = [], made: Made = {}): SiteEvent[] {
  const n = visitsMade++;
  const start = NOW.getTime() - (made.daysAgo ?? 0) * 24 * HOUR_MS - 2 * HOUR_MS + n * 1000;
  const { base = HT, site = 'hostile-territory', sport } = made;
  const event = (at: number, name: string, path: string, own: SiteEvent['own'] = {}): SiteEvent => ({
    name, at: start + at * 1000, device: made.device ?? `browser-${n}`, url: `${base}${path}`, site, sport, own, ...made.source,
  });
  const last = pages.at(-1)!;
  return [
    ...pages.map((path, i) => event(i * 20, VIEW, path)),
    ...sent.map((name, i) => event(1 + i, name, pages[0]!)),
    ...(left ? [event(pages.length * 20, 'leave', last, { load: `load-${n}`, scroll: 40, taps: 0, ...left })] : []),
  ];
}
const counted = (events: SiteEvent[]): CountedVisit => countedVisits(events, VIEW)[0]!;

describe('a visit, as the counts read it', () => {
  it('is quick under ten seconds on one page with no tap', () => {
    expect(isQuick(counted(visit(['/'], { seconds: 9 })))).toBe(true);
    expect(isQuick(counted(visit(['/'], { seconds: 10 })))).toBe(false);
    expect(isQuick(counted(visit(['/'], { seconds: 4, taps: 1 })))).toBe(false);
    expect(isQuick(counted(visit(['/', '/coach/ryan-day'], { seconds: 4 })))).toBe(false);
  });

  it('stayed with a second page, or a minute in view, or three taps', () => {
    expect(hasStayed(counted(visit(['/', '/coach/ryan-day'], { seconds: 12 })))).toBe(true);
    expect(hasStayed(counted(visit(['/'], { seconds: 60 })))).toBe(true);
    expect(hasStayed(counted(visit(['/'], { seconds: 20, taps: 3 })))).toBe(true);
    expect(hasStayed(counted(visit(['/'], { seconds: 59, taps: 2 })))).toBe(false);
  });

  it('is neither when no leave measured it, whatever it saw', () => {
    const unmeasured = counted(visit(['/', '/coach/ryan-day'], null));
    expect([unmeasured.measured, isQuick(unmeasured), hasStayed(unmeasured)]).toEqual([false, false, false]);
    expect(isQuick(counted(visit(['/'], null)))).toBe(false);
  });

  it('keeps its pages in order, a page seen again in its place and a changed query in none', () => {
    const v = counted(visit(['/', '/?venue=home', '/coach/ryan-day', '/'], { seconds: 80 }));
    expect(v.path.map((a) => a.page)).toEqual(['/', '/coach/ryan-day', '/']);
    expect(v.pages).toBe(2);
  });

  it('names its events, without the page view and the leave', () => {
    expect(counted(visit(['/'], { seconds: 30 }, ['venue', 'coach_open', 'coach_open'])).events).toEqual(['venue', 'coach_open']);
  });
});

describe('what a set of visits did', () => {
  it('counts quick and stayed among the measured, and the median of their seconds', () => {
    const visits = countedVisits([
      ...visit(['/'], { seconds: 4 }), ...visit(['/'], { seconds: 30 }), ...visit(['/', '/coach/ryan-day'], { seconds: 100 }),
      ...visit(['/'], null),
    ], VIEW);
    expect(countsOf(visits)).toEqual({ visits: 4, visitors: 4, measured: 3, quick: 1, stayed: 1, median: 30, seconds: 134, pagesAVisit: 1.3 });
  });

  it('counts a visitor once however often they came', () => {
    const visits = countedVisits([
      ...visit(['/'], { seconds: 30 }, [], { device: 'a', daysAgo: 2 }), ...visit(['/'], { seconds: 30 }, [], { device: 'a' }),
    ], VIEW);
    expect([countsOf(visits).visits, countsOf(visits).visitors]).toEqual([2, 1]);
  });

  it('adds up half an hour of a visit at most, and leaves its median alone', () => {
    const c = countsOf(countedVisits(visit(['/'], { seconds: 10_750 }), VIEW));
    expect([c.seconds, c.median]).toEqual([SECONDS_COUNTED, 10_750]);
  });

  it('has no median with nothing measured', () => {
    expect(countsOf(countedVisits(visit(['/'], null), VIEW))).toMatchObject({ visits: 1, measured: 0, median: null, seconds: 0 });
    expect(countsOf([])).toMatchObject({ visits: 0, median: null, pagesAVisit: 0 });
  });
});

describe('starred pages', () => {
  const teams = ['boise-state', 'ucla', 'lsu', 'smu'];
  const star = (pages: string[]) => Object.fromEntries(starredPages(pages));

  it('reads pages alike but for one segment as one, from four of them', () => {
    expect(teams).toHaveLength(ALIKE_PAGES);
    const starred = star(teams.map((team) => `/teams/${team}/running-backs`));
    expect(starred['/teams/ucla/running-backs']).toBe('/teams/*/running-backs');
    const three = star(teams.slice(1).map((team) => `/teams/${team}/running-backs`));
    expect(three['/teams/ucla/running-backs']).toBe('/teams/ucla/running-backs');
  });

  it('stars the segment more pages differ in', () => {
    // LSU has four positions and its quarterbacks page has five teams: the team is the star
    const pages = [
      ...['quarterbacks', 'kickers', 'punters', 'guards'].map((position) => `/teams/lsu/${position}`),
      ...teams.map((team) => `/teams/${team}/quarterbacks`), '/teams/ohio-state/quarterbacks',
    ];
    expect(star(pages)['/teams/lsu/quarterbacks']).toBe('/teams/*/quarterbacks');
    expect(star(pages)['/teams/lsu/kickers']).toBe('/teams/lsu/*');
  });

  it('never stars a page with one segment, or the root', () => {
    const named = ['/longest-home-win-streaks', '/longest-road-win-streaks', '/longest-bowl-win-streaks', '/longest-active-win-streaks', '/'];
    expect(star(named)).toEqual(Object.fromEntries(named.map((page) => [page, page])));
  });

  it('counts a page once however often it was seen', () => {
    expect(star(['/coach/a', '/coach/a', '/coach/a', '/coach/a'])['/coach/a']).toBe('/coach/a');
  });
});

describe('the landings screen', () => {
  const google = { source: { referrer: 'https://www.google.com/' } };
  const reddit = { source: { referrer: 'https://www.reddit.com/' } };
  const pun = { base: PUN, site: 'puttingupnumbers', sport: 'cfb' };
  const events = [
    // Hostile Territory's board: two went on to a coach, one of them twice, and one left at once
    ...visit(['/', '/coach/ryan-day', '/', '/coach/kirby-smart'], { seconds: 200, taps: 6 }, ['venue', 'coach_open'], { ...reddit, device: 'a' }),
    ...visit(['/?venue=home', '/coach/lane-kiffin'], { seconds: 90 }, ['coach_open'], { ...reddit, device: 'a', daysAgo: 1 }),
    ...visit(['/', '/coach/ryan-day'], { seconds: 50 }, ['coach_open'], reddit),
    ...visit(['/'], { seconds: 3 }, ['venue']),
    ...visit(['/'], null, ['venue'], google),
    // four teams' quarterbacks on Putting Up Numbers, each from Google
    ...['lsu', 'smu', 'ucla'].flatMap((team) => visit([`/teams/${team}/quarterbacks`], { seconds: 5 }, [], { ...pun, ...google })),
    ...visit(['/teams/lsu/quarterbacks', '/players/garrett-nussmeier'], { seconds: 70 }, [], { ...pun, ...google }),
    ...visit(['/teams/buffalo/quarterbacks'], { seconds: 20 }, [], { ...pun, ...google }),
    // before the week
    ...visit(['/sports'], { seconds: 30 }, [], { daysAgo: 8 }),
  ];
  const s = landingsOf(events, VIEW, TZ, NOW);
  const row = (page: string) => s.landings.find((l) => l.page === page)!;

  it('reads the visits that started since the midnight six days ago', () => {
    expect(new Date(s.from).toISOString()).toBe('2026-11-14T05:00:00.000Z');
    expect(s.landings.map((l) => [l.site, l.page, l.visits])).toEqual([
      ['hostile territory', '/', 5],
      ['PUN CFB', '/teams/*/quarterbacks', 5],
    ]);
  });

  it('counts each site, the most visits first', () => {
    expect(s.sites.map((r) => [r.site, r.visits, r.visitors, r.measured, r.quick, r.stayed, r.median])).toEqual([
      ['hostile territory', 5, 4, 4, 1, 3, 70],
      ['PUN CFB', 5, 5, 5, 3, 1, 5],
    ]);
  });

  it('counts each source by the site it sent visits to', () => {
    expect(s.sources.map((r) => [r.source, r.site, r.visits, r.stayed])).toEqual([
      ['google', 'PUN CFB', 5, 1],
      ['reddit', 'hostile territory', 3, 3],
      ['direct', 'hostile territory', 1, 0],
      ['google', 'hostile territory', 1, 0],
    ]);
  });

  it('lists a starred row\'s pages, each with its counts and a link', () => {
    const quarterbacks = row('/teams/*/quarterbacks');
    expect(quarterbacks.href).toBeNull();
    expect(quarterbacks.under.map((u) => [u.page, u.visits, u.quick, u.href])).toEqual([
      ['/teams/lsu/quarterbacks', 2, 1, 'https://puttingupnumbers.com/cfb/teams/lsu/quarterbacks'],
      ['/teams/buffalo/quarterbacks', 1, 0, 'https://puttingupnumbers.com/cfb/teams/buffalo/quarterbacks'],
      ['/teams/smu/quarterbacks', 1, 1, 'https://puttingupnumbers.com/cfb/teams/smu/quarterbacks'],
      ['/teams/ucla/quarterbacks', 1, 1, 'https://puttingupnumbers.com/cfb/teams/ucla/quarterbacks'],
    ]);
  });

  it('links a page without the query a visit landed with', () => {
    expect([row('/').href, row('/').under]).toEqual(['https://drewhoover.com/hostile-territory/', []]);
  });

  it('lists where a landing\'s visits came from', () => {
    expect(row('/').sources).toEqual([{ source: 'reddit', visits: 3 }, { source: 'direct', visits: 1 }, { source: 'google', visits: 1 }]);
  });

  it('counts the first other page a visit saw, in visitors, and the visits that saw none', () => {
    // three visits went on to a coach, two of them one browser's; fewer than four coaches, so each is its own page
    expect(row('/').next).toEqual([
      { site: 'hostile territory', page: '/coach/ryan-day', visitors: 2 },
      { site: 'hostile territory', page: '/coach/lane-kiffin', visitors: 1 },
    ]);
    expect(row('/').stopped).toBe(2);
    expect(row('/teams/*/quarterbacks').next).toEqual([{ site: 'PUN CFB', page: '/players/garrett-nussmeier', visitors: 1 }]);
  });

  it('counts the measured visits that sent each event, and those of them that stayed', () => {
    expect(row('/').events).toEqual([
      { name: 'coach_open', visits: 3, stayed: 3 },
      { name: 'venue', visits: 2, stayed: 1 },
    ]);
  });
});
