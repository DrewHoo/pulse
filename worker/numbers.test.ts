import { describe, expect, it } from 'vitest';
import { numbersOf, type FromQueries } from './numbers';
import type { SiteEvent } from './visitors';

const PAGEVIEW = '$mp_web_page_view';
const SK = 'https://drewhoover.com/cfb-streak-king/';
const NOW = { date: '2026-10-11', hour: 11, minute: 38, tz: 'America/New_York' };
const AT = new Date('2026-10-11T15:38:00Z');
const NONE: FromQueries = { shares: null, redditLinks: null, measures: null, redditLandings: [] };

// A page view at a New York time ("2026-10-11 09:15"), EDT then.
function view(device: string, local: string, url = SK, more: Partial<SiteEvent> = {}): SiteEvent {
  return { name: PAGEVIEW, at: Date.parse(`${local.replace(' ', 'T')}:00-04:00`), device, url, own: {}, ...more };
}

const numbers = (events: SiteEvent[], path: Parameters<typeof numbersOf>[3] = 'cfb-streak-king', now = NOW) =>
  numbersOf(events, PAGEVIEW, now, path, NONE, AT);

describe('the numbers, counted from the export', () => {
  const events = [
    view('a', '2026-10-11 09:05'), view('a', '2026-10-11 09:40', `${SK}games/`), view('b', '2026-10-11 09:50', `${SK}games/`),
    view('c', '2026-10-11 11:10'),
    view('a', '2026-10-10 09:00'), view('d', '2026-10-10 23:30'),
    view('e', '2026-10-05 12:00'),
    view('f', '2026-10-04 12:00'), // the day before the week
    { ...view('a', '2026-10-11 10:00'), name: 'leave' }, // not a page view
    view('g', '2026-10-11 10:00', 'https://puttingupnumbers.com/nfl/'), // another site
  ];
  const s = numbers(events);

  it('cuts today at the current hour and keeps all of yesterday', () => {
    expect(s.hours.today.slice(9, 13)).toEqual([3, 0, 1, null]);
    expect(s.hours.todayVisitors.slice(9, 12)).toEqual([2, 0, 1]);
    expect(s.hours.yesterday[9]).toBe(1);
    expect(s.hours.yesterday[23]).toBe(1);
    expect(s.hours.yesterday).toHaveLength(24);
  });

  it('totals views and visitors', () => {
    expect(s.totals).toEqual({
      thisHour: 1, thisHourVisitors: 1, lastHour: 0, lastHourVisitors: 0,
      today: 4, todayVisitors: 3, todayVisitorHours: 3,
      yesterdayToHour: 1, yesterdayVisitorHoursToHour: 1, yesterday: 2, yesterdayVisitors: 2,
      week: 7, weekVisitorsPerDay: 1,
    });
  });

  it('reads last hour from yesterday at midnight', () => {
    expect(numbers(events, 'cfb-streak-king', { ...NOW, hour: 0 }).totals.lastHour).toBe(1);
  });

  it('lists the seven days in order with visitors', () => {
    expect(s.days.map((d) => d.date)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
    expect(s.days.map((d) => d.visitors)).toEqual([1, 0, 0, 0, 0, 2, 3]);
  });

  it('ranks pages by today\'s visitors, without the filter\'s own path', () => {
    expect(s.pages).toEqual([
      { name: '/', today: 2, visitors: 2, week: 5 },
      { name: '/games/', today: 2, visitors: 2, week: 2 },
    ]);
  });

  it('reads every site with no filter', () => {
    expect(numbers(events, 'all').totals.today).toBe(5);
  });

  it('counts today\'s visitors seen on an earlier day this week, and the week\'s on two days or more', () => {
    expect(s.returning).toEqual({ today: 1, week: 1, weekVisitors: 5 });
  });
});

describe('time on each day', () => {
  // a `leave` at a New York time, with the running totals of one page load
  const leave = (device: string, local: string, seconds: number, url = SK): SiteEvent =>
    ({ ...view(device, local, url), name: 'leave', own: { load: `${device} ${local}`, seconds, scroll: 50, taps: 0 } });
  const s = numbers([
    view('a', '2026-10-11 09:00'), view('a', '2026-10-11 09:01', `${SK}games/`), leave('a', '2026-10-11 09:03', 150, `${SK}games/`),
    view('b', '2026-10-11 10:00'), leave('b', '2026-10-11 10:01', 30),
    view('c', '2026-10-11 10:30'), // no leave: a visit, with no time
    view('d', '2026-10-10 23:50'), leave('d', '2026-10-11 00:05', 600), // started yesterday, so it's yesterday's
    view('e', '2026-10-11 09:00', 'https://puttingupnumbers.com/nfl/'), leave('e', '2026-10-11 09:01', 40, 'https://puttingupnumbers.com/nfl/'),
  ]);
  const [yesterday, today] = s.days.slice(5);

  it('gives a day its visits, seconds in view, the median visit and pages a visit', () => {
    expect(today).toMatchObject({ date: '2026-10-11', visits: 3, seconds: 180, median: 90, pagesAVisit: 1.3 });
  });

  it('puts a visit on the day it started, and leaves a day with none empty', () => {
    expect(yesterday).toMatchObject({ date: '2026-10-10', visits: 1, seconds: 600, median: 600, pagesAVisit: 1 });
    expect(s.days[0]).toMatchObject({ visits: 0, seconds: 0, median: null, pagesAVisit: 0 });
  });

  it('counts the visits that landed under the filter', () => {
    expect(numbers([view('e', '2026-10-11 09:00', 'https://puttingupnumbers.com/nfl/')], 'all').days[6]!.visits).toBe(1);
    expect(today!.visits).toBe(3);
  });
});

describe('where the views came from', () => {
  const at = '2026-10-11 09:00';
  const s = numbers([
    view('a', at), view('b', at),
    view('c', at, SK, { referrer: 'https://www.google.com/' }), view('d', at, SK, { referrer: 'https://google.com/' }),
    view('e', at, SK, { referrer: 'https://drewhoover.com/hostile-territory/' }),
    view('f', at, SK, { referrer: 'https://old.reddit.com/r/rolltide/comments/1x1km4m/thread/' }),
    view('g', at, SK, { referrer: 'https://www.reddit.com/' }),
    view('h', at, SK, { utmSource: 'chatgpt.com' }), view('h', '2026-10-11 09:01', SK, { utmSource: 'chatgpt.com' }),
    view('i', at, SK, { referrer: 'https://www.perplexity.ai/' }),
    view('j', at, SK, { utmSource: 'newsletter' }), // a tag, but not an assistant
  ]);

  it('lists direct and Drew\'s own sites by domain, other referrers by URL, merged by name', () => {
    expect(s.referrers.map((r) => [r.name, r.visitors])).toEqual([
      ['(direct)', 4],
      ['google.com', 2],
      ['drewhoover.com', 1],
      ['old.reddit.com/r/rolltide/comments/1x1km4m/thread', 1],
      ['perplexity.ai', 1],
      ['reddit.com', 1],
    ]);
  });

  it('counts every reddit-referred view as one row', () => {
    expect(s.reddit.views).toEqual({ name: 'reddit', today: 2, visitors: 2, week: 2 });
  });

  it('lists AI assistants by tag or referrer, one row each, and nothing else', () => {
    expect(s.ai).toEqual([
      { name: 'ChatGPT', today: 2, visitors: 1, week: 2 },
      { name: 'Perplexity', today: 1, visitors: 1, week: 1 },
    ]);
  });
});

describe('Putting Up Numbers', () => {
  const PUN = 'https://puttingupnumbers.com/';
  const events = [
    view('a', '2026-10-11 09:00', `${PUN}cfb/`, { sport: 'cfb' }), view('b', '2026-10-11 09:00', `${PUN}cfb/`, { sport: 'cfb' }),
    view('c', '2026-10-10 09:00', `${PUN}nfl/`, { sport: 'nfl' }),
    view('d', '2026-10-11 09:00', PUN),
  ];

  it('lists its sports by visitors, the home for a page with none', () => {
    expect(numbers(events, 'puttingupnumbers').sports).toEqual([
      { name: 'college football', today: 2, visitors: 2, week: 2 },
      { name: 'home', today: 1, visitors: 1, week: 1 },
      { name: 'NFL', today: 0, visitors: 0, week: 1 },
    ]);
    expect(numbers(events, 'all').sports).toEqual([]);
  });
});
