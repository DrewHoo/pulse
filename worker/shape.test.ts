import { describe, expect, it } from 'vitest';
import { shape, type Raw, type Series } from './shape';
import { addDays, localNow } from './time';

const EVENT = '$mp_web_page_view';

const series = (values: Record<string, Record<string, number>>, labels: string[]): Series => ({
  data: { series: labels, values },
});

function raw(): Raw {
  const hours: Record<string, number> = {};
  for (let h = 0; h < 24; h++) {
    hours[`2026-10-10 ${String(h).padStart(2, '0')}:00:00`] = 10 + h; // yesterday: 10..33
    hours[`2026-10-11 ${String(h).padStart(2, '0')}:00:00`] = h === 12 ? 999 : h; // today: 0..11 then a future bucket Mixpanel should not have sent
  }
  const dayLabels = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];
  const days = Object.fromEntries(dayLabels.map((d, i) => [d, 100 * (i + 1)]));
  return {
    event: EVENT,
    hours: series({ [EVENT]: hours }, Object.keys(hours)),
    days: series({ [EVENT]: days }, dayLabels),
    referrers: series({
      'google.com': { '2026-10-10': 5, '2026-10-11': 3 },
      'undefined': { '2026-10-10': 20, '2026-10-11': 7 },
      'news.ycombinator.com': { '2026-10-09': 40 },
      'nothing.example': { '2026-10-09': 0 },
    }, dayLabels),
    pages: series({
      '/cfb-streak-king/': { '2026-10-11': 9 },
      '/': { '2026-10-10': 4, '2026-10-11': 9 },
    }, dayLabels),
  };
}

const NOW = { date: '2026-10-11', hour: 11, minute: 38, tz: 'America/New_York' };

describe('shape', () => {
  const s = shape(raw(), NOW, new Date('2026-10-11T15:38:00Z'));

  it('cuts today at the current hour and keeps all of yesterday', () => {
    expect(s.hours.today.slice(0, 12)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(s.hours.today.slice(12).every((n) => n === null)).toBe(true);
    expect(s.hours.yesterday).toHaveLength(24);
    expect(s.hours.yesterday[23]).toBe(33);
  });

  it('totals this hour, last hour, today, yesterday to the same hour, and the week', () => {
    expect(s.totals).toEqual({
      thisHour: 11,
      lastHour: 10,
      today: 66,
      yesterdayToHour: 10 * 12 + 66,
      yesterday: 10 * 24 + 276,
      week: 2800,
    });
  });

  it('reads last hour from yesterday at midnight', () => {
    const t = shape(raw(), { ...NOW, hour: 0 }).totals;
    expect(t.lastHour).toBe(33);
    expect(t.today).toBe(0);
  });

  it('ranks rows by today then by week, names direct traffic, drops empty segments', () => {
    expect(s.referrers.map((r) => r.name)).toEqual(['(direct)', 'google.com', 'news.ycombinator.com']);
    expect(s.referrers[0]).toEqual({ name: '(direct)', today: 7, week: 27 });
    expect(s.pages.map((r) => [r.name, r.today, r.week])).toEqual([['/', 9, 13], ['/cfb-streak-king/', 9, 9]]);
  });

  it('lists the seven days in order', () => {
    expect(s.days.map((d) => d.n)).toEqual([100, 200, 300, 400, 500, 600, 700]);
    expect(s.days[6]?.date).toBe('2026-10-11');
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
