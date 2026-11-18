import { describe, expect, it } from 'vitest';
import {
  exportDays, landingsFrom, readEvent, readExport, visitOf, visitorsOf, EVENTS_KEPT, LANDING_DAYS, type ExportedEvent, type SiteEvent,
} from './visitors';

const VIEW = '$mp_web_page_view';
const HT = 'https://drewhoover.com/hostile-territory';
const NOW = new Date('2026-11-17T14:40:00Z'); // 9:40 am in New York
const TZ = 'America/New_York';
const minutesAgo = (m: number) => NOW.getTime() - m * 60_000;

// One browser's event on Hostile Territory, `at` in seconds after the visit's start.
let visitStart = minutesAgo(60);
function event(at: number, name: string, path = '/', more: Partial<SiteEvent> = {}): SiteEvent {
  return { name, at: visitStart + at * 1000, device: 'a', url: `${HT}${path}`, site: 'hostile-territory', own: {}, ...more };
}
const view = (at: number, path = '/', more: Partial<SiteEvent> = {}) => event(at, VIEW, path, more);

describe('reading the export', () => {
  const exported = (properties: Record<string, unknown>, name = VIEW): ExportedEvent => ({ event: name, properties });

  it('keeps an event\'s own properties and none of Mixpanel\'s or the embed\'s', () => {
    const e = readEvent(exported({
      time: 1, distinct_id: '$device:a', $device_id: 'a', $insert_id: 'x', $current_url: `${HT}/`, mp_lib: 'web',
      current_page_title: 't', utm_source: 'chatgpt.com', site: 'hostile-territory', sport: 'cfb', framed: false,
      user_agent: 'ua', coach: 'Lane Kiffin', tags: ['a', 'b'], empty: null,
    }, 'coach_open'))!;
    expect(e.own).toEqual({ coach: 'Lane Kiffin', tags: '["a","b"]' });
    expect([e.name, e.device, e.site, e.sport, e.utmSource]).toEqual(['coach_open', 'a', 'hostile-territory', 'cfb', 'chatgpt.com']);
  });

  it('skips the share worker\'s link previews, which have no browser', () => {
    expect(readEvent(exported({ time: 1, distinct_id: 'unfurl:imessage', url: `${HT}/` }, 'share unfurl'))).toBeNull();
  });

  it('drops the rows a several-day export repeats', () => {
    const line = JSON.stringify(exported({ time: 1, distinct_id: '$device:a', $device_id: 'a', $insert_id: 'x' }));
    const other = JSON.stringify(exported({ time: 2, distinct_id: '$device:a', $device_id: 'a', $insert_id: 'y' }));
    expect(readExport(`${line}\n${line}\n${other}\n`)).toHaveLength(2);
    expect(readExport('')).toEqual([]);
  });

  it('asks for the UTC days from two days before the longest day through today', () => {
    expect(exportDays(new Date('2026-11-17T14:40:00Z'))).toEqual(['2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17']);
    // a week back, for a source's landing pages
    expect(exportDays(new Date('2026-11-17T14:40:00Z'), LANDING_DAYS * 24)).toHaveLength(8);
  });
});

describe('a visit\'s summary', () => {
  it('groups page views by page, each with the query strings it was seen with, the last one last', () => {
    const v = visitOf([
      view(0), view(10, '/?cut=25'), view(20, '/coach/ryan-day/?cut=25'), view(30, '/?venue=all'), view(40, '/?cut=25'),
    ], VIEW);
    expect(v.pages.map((p) => [p.page, p.views, p.states.map((s) => s.query)])).toEqual([
      ['/', 4, ['', 'venue=all', 'cut=25']],
      ['/coach/ryan-day', 1, ['cut=25']],
    ]);
    expect([v.landing.page, v.left.page, v.left.query]).toEqual(['/', '/', 'cut=25']);
    expect(v.landing.site).toBe('hostile territory');
  });

  it('leaves out a page view replaced within two seconds, and still lists it', () => {
    // a search box sends a view a keystroke; the last one stands
    const v = visitOf([view(0), view(18, '/?q=K'), view(18.4, '/?q=Ki'), view(19, '/?q=Kiffin'), view(30, '/coach/lane-kiffin/?q=Kiffin')], VIEW);
    expect([v.views, v.passing]).toEqual([5, 2]);
    expect(v.pages[0]!.states.map((s) => s.query)).toEqual(['', 'q=Kiffin']);
    expect(v.events.filter((e) => e.passing).map((e) => e.detail)).toEqual(['/?q=K', '/?q=Ki']);
    expect(v.events.every((e) => e.view && e.name === VIEW)).toBe(true);
  });

  it('lands on the page a redirect settled at', () => {
    const v = visitOf([view(0, '/?c=home'), view(0.3, '/build/?c=home')], VIEW);
    expect(v.landing.page).toBe('/build');
  });

  it('lists each filter\'s values without the ones that were typing', () => {
    // a slow typist's "Kiffi" stands for three seconds; min=1 before min=10 is two picks, not typing
    const v = visitOf([view(0, '/?q=Kiffi&min=1'), view(5, '/?q=Kiffin&min=1'), view(10, '/?q=Josh&min=10')], VIEW);
    expect(v.filters).toEqual([{ name: 'q', values: ['Kiffin', 'Josh'] }, { name: 'min', values: ['1', '10'] }]);
  });

  it('leaves a utm tag to the source, so a tagged landing is still a one-page visit', () => {
    const v = visitOf([view(0, '/?utm_source=chatgpt.com', { utmSource: 'chatgpt.com' })], VIEW);
    expect([v.filters, v.source, v.onePage]).toEqual([[], 'chatgpt', true]);
  });

  it('counts every other event by name with its own properties\' values, a number as its range', () => {
    const v = visitOf([
      view(0),
      event(5, 'coach_open', '/', { own: { coach: 'Kirby Smart' } }),
      event(9, 'coach_open', '/', { own: { coach: 'Ryan Day' } }),
      event(12, 'coach_open', '/', { own: { coach: 'Kirby Smart' } }),
      event(20, 'answer', '/', { own: { ms: 212, words: 'most points' } }),
      event(25, 'answer', '/', { own: { ms: 80, words: 'most points' } }),
    ], VIEW);
    expect(v.eventTotals.map((e) => [e.name, e.count, e.properties])).toEqual([
      ['coach_open', 3, [{ name: 'coach', values: ['Kirby Smart', 'Ryan Day'] }]],
      ['answer', 2, [{ name: 'ms', values: ['80–212'] }, { name: 'words', values: ['most points'] }]],
    ]);
  });

  it('picks the one property a card shows: the most distinct values, words before numbers', () => {
    const open = (at: number, team: string, len: number) => event(at, 'team open', '/', { own: { len, scope: 'active', team } });
    const v = visitOf([
      view(0), open(5, 'uconn', 19), open(9, 'akron', 12), open(14, 'kent-state', 7),
      event(20, 'front', '/', { own: { more: 74, rows: 10 } }),
      event(25, 'breakers', '/'),
    ], VIEW);
    // `len` varied three times too, but it is a number; `front` has only numbers, so its first stands
    expect(v.eventTotals.map((e) => [e.name, e.cardValues])).toEqual([
      ['team open', ['uconn', 'akron', 'kent-state']], ['front', ['74']], ['breakers', []],
    ]);
  });

  it('marks an event named for a filter, which a card leaves to the opened card', () => {
    const v = visitOf([view(0, '/?venue=home'), event(1, 'venue', '/?venue=home', { own: { venue: 'home' } }), event(5, 'coach_open', '/', { own: { coach: 'Ryan Day' } })], VIEW);
    expect(v.eventTotals.map((e) => [e.name, e.namedForFilter])).toEqual([['venue', true], ['coach_open', false]]);
  });

  it('reads pages under one parent as the parent and its children, the landing first', () => {
    const v = visitOf([
      view(0), view(10, '/coach/kirby-smart/'), view(20), view(30, '/coach/ryan-day/'), view(40, '/venues/'),
    ], VIEW);
    expect(v.pageGroups).toEqual([
      { path: '/', children: [], views: 2 },
      { path: '/coach/', children: ['kirby-smart', 'ryan-day'], views: 2 },
      { path: '/venues', children: [], views: 1 },
    ]);
  });

  it('reads time in view from the last leave of each load', () => {
    const leave = (at: number, load: string, seconds: number, scroll: number, taps: number) =>
      event(at, 'leave', '/', { own: { load, seconds, scroll, taps } });
    const v = visitOf([view(0), leave(30, 'x', 30, 20, 1), leave(90, 'x', 41, 55, 2), view(100), leave(130, 'y', 12, 35, 0)], VIEW);
    expect([v.seconds, v.scroll, v.taps]).toEqual([53, 55, 2]);
    expect(v.eventTotals).toEqual([]); // a leave is the time in view, not an event of the visit's
    expect(v.events[1]).toMatchObject({ name: 'leave', detail: '30s · 20% · 1 tap' });
  });

  it('spans its events when no leave came, with no scroll to report', () => {
    const v = visitOf([view(0), view(59, '/coach/ryan-day/')], VIEW);
    expect([v.seconds, v.scroll]).toEqual([59, null]);
  });

  it('is a one-page visit with one page, no filter and no event', () => {
    expect(visitOf([view(0), event(13, 'leave', '/', { own: { load: 'x', seconds: 13 } })], VIEW).onePage).toBe(true);
    expect(visitOf([view(0, '/?cut=25')], VIEW).onePage).toBe(false);
    expect(visitOf([view(0), event(3, 'venue', '/', { own: { venue: 'home' } })], VIEW).onePage).toBe(false);
  });

  it('is on its first event\'s page when it has no page view of its own', () => {
    const v = visitOf([event(0, 'leave', '/coach/sam-pittman/', { own: { load: 'x', seconds: 43 } })], VIEW);
    expect([v.landing.page, v.pages.length, v.views]).toEqual(['/coach/sam-pittman', 1, 0]);
  });

  it('keeps a cap of its events and the count of all of them', () => {
    const many = Array.from({ length: EVENTS_KEPT + 5 }, (_, i) => event(i * 5, 'venue', '/', { own: { venue: 'home' } }));
    const v = visitOf(many, VIEW);
    expect([v.events.length, v.eventCount]).toEqual([EVENTS_KEPT, EVENTS_KEPT + 5]);
  });

  it('names where it came from by its first event', () => {
    expect(visitOf([view(0, '/', { referrer: 'https://www.reddit.com/' }), view(9, '/', { referrer: 'https://www.reddit.com/' })], VIEW).source).toBe('reddit');
    expect(visitOf([view(0)], VIEW).source).toBe('direct');
  });
});

describe('visitors', () => {
  // `start` minutes before now, for browser `device`
  const visit = (device: string, start: number, more: Partial<SiteEvent> = {}, path = '/') =>
    ({ name: VIEW, at: minutesAgo(start), device, url: `${HT}${path}`, site: 'hostile-territory', own: {}, ...more });

  it('lists each browser once, the latest event first, and never mixes two browsers\' events', () => {
    const events = [visit('a', 50), visit('b', 40), visit('a', 30), visit('b', 20, {}, '/coach/ryan-day/'), visit('c', 600)];
    const { visitors } = visitorsOf(events, VIEW, TZ, NOW);
    expect(visitors.map((v) => v.id)).toEqual(['b', 'a']); // c left at 11:40 pm yesterday
    expect(visitors[0]!.visits[0]!.pages.map((p) => p.page)).toEqual(['/', '/coach/ryan-day']);
    expect(visitors[1]!.visits[0]!.views).toBe(2);
  });

  it('splits a browser\'s events into visits at a gap of thirty minutes, latest first', () => {
    const events = [visit('a', 200), visit('a', 190), visit('a', 100), visit('a', 71), visit('a', 10)];
    const { visitors } = visitorsOf(events, VIEW, TZ, NOW);
    expect(visitors[0]!.visits.map((v) => v.views)).toEqual([1, 2, 2]);
  });

  it('starts the list over at midnight', () => {
    const justAfter = new Date('2026-11-17T05:20:00Z'); // 12:20 am
    const events = [{ ...visit('a', 0), at: justAfter.getTime() - 60 * 60_000 }, { ...visit('b', 0), at: justAfter.getTime() - 10 * 60_000 }];
    expect(visitorsOf(events, VIEW, TZ, justAfter).visitors.map((v) => v.id)).toEqual(['b']);
  });

  it('describes the browser by its latest event', () => {
    const facts = { city: 'Chicago', region: 'Illinois', country: 'US', deviceName: 'iPhone', browser: 'Mobile Safari', screenWidth: 390, screenHeight: 844, firstReferrer: 'https://www.google.com/' };
    const [v] = visitorsOf([visit('a', 5, facts)], VIEW, TZ, NOW).visitors;
    expect([v!.place, v!.device, v!.browser, v!.screen, v!.firstSource]).toEqual(['Chicago, IL', 'iPhone', 'Mobile Safari', '390×844', 'google']);
  });
});

describe('arrivals', () => {
  const reddit = { referrer: 'https://www.reddit.com/' };
  const arrive = (device: string, hoursAgo: number, more: Partial<SiteEvent> = {}, path = '/') =>
    ({ name: VIEW, at: NOW.getTime() - hoursAgo * 3_600_000, device, url: `${HT}${path}`, site: 'hostile-territory', own: {}, ...more });

  it('counts the window\'s visitors by source and site, beside the same hours yesterday', () => {
    const events = [
      arrive('a', 1), arrive('b', 2), arrive('c', 3, reddit),
      arrive('d', 25), arrive('e', 30, reddit), arrive('f', 31, reddit), // yesterday from midnight to 9:40 am
      arrive('g', 20), // yesterday, outside them
    ];
    const { arrivals } = visitorsOf(events, VIEW, TZ, NOW);
    expect(arrivals.map((a) => [a.source, a.site, a.visitors, a.yesterday, a.isNew])).toEqual([
      ['direct', 'hostile territory', 2, 1, false],
      ['reddit', 'hostile territory', 1, 2, false],
    ]);
  });

  it('marks a source new when the two days before the window have none like it, and a landing page the same way', () => {
    const events = [
      arrive('a', 1, reddit, '/coach/josh-heupel/'), arrive('b', 2, reddit), arrive('c', 3),
      arrive('d', 30, reddit), // reddit sent someone to / yesterday, to nobody's coach page
    ];
    const { arrivals } = visitorsOf(events, VIEW, TZ, NOW);
    const [fromReddit, direct] = [arrivals.find((a) => a.source === 'reddit')!, arrivals.find((a) => a.source === 'direct')!];
    expect(direct.isNew).toBe(true);
    expect(fromReddit.isNew).toBe(false);
    expect(fromReddit.landings.map((l) => [l.page, l.visitors, l.isNew])).toEqual([['/', 1, false], ['/coach/josh-heupel', 1, true]]);
  });

  it('counts a visit where it started, not where it reaches', () => {
    // began at 11:40 pm yesterday and went past midnight: a card, not one of today's arrivals
    const events = [arrive('a', 10), arrive('a', 9.7), arrive('a', 9.4), arrive('a', 9.1), arrive('a', 8.8)];
    const answer = visitorsOf(events, VIEW, TZ, NOW);
    expect(answer.visitors).toHaveLength(1);
    expect(answer.arrivals).toEqual([]);
  });
});

describe('a source\'s landing pages over the week', () => {
  const reddit = { referrer: 'https://www.reddit.com/' };
  const arrive = (device: string, hoursAgo: number, path = '/', more: Partial<SiteEvent> = reddit) =>
    ({ name: VIEW, at: NOW.getTime() - hoursAgo * 3_600_000, device, url: `${HT}${path}`, site: 'hostile-territory', own: {}, ...more });

  it('lists each address the source\'s visits landed on, the most visitors first', () => {
    const events = [
      arrive('a', 60), arrive('b', 50), arrive('c', 2),
      arrive('d', 30, '/?cut=25&venue=all'), arrive('d', 29.9, '/coach/ryan-day/?cut=25&venue=all'), // one visit: it landed once
      arrive('e', 3, '/', {}), // direct, not reddit's
    ];
    const landings = landingsFrom('reddit', events, VIEW, NOW);
    expect(landings.map((l) => [l.site, l.page, l.query, l.visitors])).toEqual([
      ['hostile territory', '/', '', 3],
      ['hostile territory', '/', 'cut=25&venue=all', 1],
    ]);
    expect([landings[0]!.first, landings[0]!.last]).toEqual([NOW.getTime() - 60 * 3_600_000, NOW.getTime() - 2 * 3_600_000]);
  });

  it('counts a browser once however often it comes back by the link', () => {
    const [landing] = landingsFrom('reddit', [arrive('a', 50), arrive('a', 20), arrive('a', 1)], VIEW, NOW);
    expect(landing!.visitors).toBe(1);
  });

  it('marks a link new when its first arrival was in the last day', () => {
    const events = [arrive('a', 100), arrive('b', 5), arrive('c', 5, '/coach/josh-heupel/')];
    expect(landingsFrom('reddit', events, VIEW, NOW).map((l) => [l.page, l.isNew])).toEqual([['/', false], ['/coach/josh-heupel', true]]);
  });

  it('reaches seven days back and no further', () => {
    const events = [arrive('a', 24 * 8), arrive('b', 24 * 6)];
    expect(landingsFrom('reddit', events, VIEW, NOW).map((l) => l.visitors)).toEqual([1]);
  });
});
