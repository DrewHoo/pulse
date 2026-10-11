import { describe, expect, it } from 'vitest';
import { outsideName, shape, type Raw, type Series } from './shape';
import { addDays, localNow } from './time';

const EVENT = '$mp_web_page_view';
const DAYS = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];

const series = (values: Record<string, Record<string, number>>, labels: string[] = DAYS): Series => ({
  data: { series: labels, values },
});

function raw(): Raw {
  const hours: Record<string, number> = {};
  const hoursUnique: Record<string, number> = {};
  for (let h = 0; h < 24; h++) {
    const hh = String(h).padStart(2, '0');
    hours[`2026-10-10 ${hh}:00:00`] = 10 + h; // yesterday: 10..33
    hours[`2026-10-11 ${hh}:00:00`] = h === 12 ? 999 : h; // today: 0..11, then a future bucket Mixpanel should not send
    hoursUnique[`2026-10-10 ${hh}:00:00`] = 2;
    hoursUnique[`2026-10-11 ${hh}:00:00`] = 1;
  }
  const byDay = (per: number) => Object.fromEntries(DAYS.map((d, i) => [d, per * (i + 1)]));
  return {
    event: EVENT,
    hours: series({ [EVENT]: hours }, Object.keys(hours)),
    hoursUnique: series({ [EVENT]: hoursUnique }, Object.keys(hoursUnique)),
    days: series({ [EVENT]: byDay(100) }),
    daysUnique: series({ [EVENT]: byDay(10) }),
    domains: series({
      'undefined': { '2026-10-10': 20, '2026-10-11': 7 },
      'drewhoover.com': { '2026-10-11': 4 },
      'www.reddit.com': { '2026-10-11': 50 }, // outside: listed by URL instead
    }),
    domainsUniqueToday: series({ 'undefined': { '2026-10-11': 5 }, 'drewhoover.com': { '2026-10-11': 1 } }, ['2026-10-11']),
    urls: series({
      'https://www.google.com/': { '2026-10-10': 5, '2026-10-11': 3 },
      'https://google.com/': { '2026-10-11': 2 },
      'https://old.reddit.com/r/rolltide/comments/1x1km4m/thread/': { '2026-10-09': 40 },
      'https://nothing.example/': { '2026-10-09': 0 },
    }),
    urlsUniqueToday: series({
      'https://www.google.com/': { '2026-10-11': 2 },
      'https://google.com/': { '2026-10-11': 1 },
    }, ['2026-10-11']),
    pages: series({
      '/cfb-streak-king/': { '2026-10-11': 9 },
      '/': { '2026-10-10': 4, '2026-10-11': 9 },
    }),
    pagesUniqueToday: series({ '/cfb-streak-king/': { '2026-10-11': 3 }, '/': { '2026-10-11': 6 } }, ['2026-10-11']),
  };
}

const NOW = { date: '2026-10-11', hour: 11, minute: 38, tz: 'America/New_York' };

describe('shape', () => {
  const s = shape(raw(), NOW, new Date('2026-10-11T15:38:00Z'));

  it('cuts today at the current hour and keeps all of yesterday', () => {
    expect(s.hours.today.slice(0, 12)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(s.hours.today.slice(12).every((n) => n === null)).toBe(true);
    expect(s.hours.todayVisitors.slice(0, 12).every((n) => n === 1)).toBe(true);
    expect(s.hours.todayVisitors[12]).toBeNull();
    expect(s.hours.yesterday).toHaveLength(24);
    expect(s.hours.yesterday[23]).toBe(33);
    expect(s.hours.yesterdayVisitors[0]).toBe(2);
  });

  it('totals views and visitors', () => {
    expect(s.totals).toEqual({
      thisHour: 11,
      thisHourVisitors: 1,
      lastHour: 10,
      today: 66,
      todayVisitors: 70,
      yesterdayToHour: 10 * 12 + 66,
      yesterday: 10 * 24 + 276,
      yesterdayVisitors: 60,
      week: 2800,
    });
  });

  it('reads last hour from yesterday at midnight', () => {
    const t = shape(raw(), { ...NOW, hour: 0 }).totals;
    expect(t.lastHour).toBe(33);
    expect(t.today).toBe(0);
  });

  it('lists direct and internal from the domains, outside referrers by URL, merged by name', () => {
    expect(s.referrers).toEqual([
      { name: '(direct)', today: 7, visitors: 5, week: 27 },
      { name: 'google.com', today: 5, visitors: 3, week: 10 },
      { name: 'drewhoover.com', today: 4, visitors: 1, week: 4 },
      { name: 'old.reddit.com/r/rolltide/comments/1x1km4m/thread', today: 0, visitors: 0, week: 40 },
    ]);
  });

  it('ranks pages by today then by week, with today\'s visitors', () => {
    expect(s.pages).toEqual([
      { name: '/', today: 9, visitors: 6, week: 13 },
      { name: '/cfb-streak-king/', today: 9, visitors: 3, week: 9 },
    ]);
  });

  it('lists the seven days in order with visitors', () => {
    expect(s.days.map((d) => d.n)).toEqual([100, 200, 300, 400, 500, 600, 700]);
    expect(s.days[6]).toEqual({ date: '2026-10-11', n: 700, visitors: 70 });
  });
});

describe('outsideName', () => {
  it('drops scheme, www and trailing slash, keeps the path', () => {
    expect(outsideName('https://www.reddit.com/')).toBe('reddit.com');
    expect(outsideName('https://old.reddit.com/r/rolltide/comments/1x1km4m/thread/')).toBe('old.reddit.com/r/rolltide/comments/1x1km4m/thread');
    expect(outsideName('android-app://com.reddit.frontpage/')).toBe('com.reddit.frontpage');
    expect(outsideName('not a url')).toBe('not a url');
  });
});

describe('time', () => {
  it('reads the clock in the project timezone', () => {
    expect(localNow('America/New_York', new Date('2026-10-11T03:30:00Z'))).toEqual({
      date: '2026-10-10', hour: 23, minute: 30, tz: 'America/New_York',
    });
    expect(localNow('America/New_York', new Date('2026-10-11T04:05:00Z')).hour).toBe(0);
  });
  it('adds days across month and year ends', () => {
    expect(addDays('2026-10-11', -6)).toBe('2026-10-05');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });
});
