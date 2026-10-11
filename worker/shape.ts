import { addDays, pad2, type LocalNow } from './time';

// The two Query API endpoints the worker reads both answer in this shape:
// `series` lists the bucket labels in order, `values` maps a segment (the
// event name for /events, a property value for /segmentation) to its count
// per bucket.
export interface Series {
  data: { series: string[]; values: Record<string, Record<string, number>> };
}

export interface Raw {
  event: string;
  hours: Series;     // unit=hour, yesterday through today
  days: Series;      // unit=day, the last 7 days
  referrers: Series; // segmentation on $referring_domain, the last 7 days
  pages: Series;     // segmentation on current_url_path, the last 7 days
}

export interface Row { name: string; today: number; week: number }

export interface Stats {
  v: 1;
  fetchedAt: string;
  tz: string;
  date: string;
  hour: number;
  minute: number;
  hours: { today: (number | null)[]; yesterday: number[] };
  days: { date: string; n: number }[];
  totals: {
    thisHour: number; lastHour: number;
    today: number; yesterdayToHour: number; yesterday: number; week: number;
  };
  referrers: Row[];
  pages: Row[];
}

export const LIST_ROWS = 12;

const sum = (xs: (number | null)[]) => xs.reduce<number>((a, x) => a + (x ?? 0), 0);

function hourly(values: Record<string, number> | undefined, date: string): number[] {
  return Array.from({ length: 24 }, (_, h) => values?.[`${date} ${pad2(h)}:00:00`] ?? 0);
}

// Segments that rename to the same row (www.reddit.com and reddit.com) merge.
function rows(series: Series, today: string, rename: (name: string) => string): Row[] {
  const merged = new Map<string, Row>();
  for (const [raw, byDay] of Object.entries(series.data.values)) {
    const week = sum(Object.values(byDay));
    if (week === 0) continue;
    const name = rename(raw);
    const row = merged.get(name) ?? { name, today: 0, week: 0 };
    row.today += byDay[today] ?? 0;
    row.week += week;
    merged.set(name, row);
  }
  return [...merged.values()]
    .sort((a, b) => b.today - a.today || b.week - a.week || a.name.localeCompare(b.name))
    .slice(0, LIST_ROWS);
}

// An event without the property lands in Mixpanel's "undefined" segment. For
// referrers that is a visit with no document.referrer, so it reads as direct.
const referrerName = (name: string) => (name === 'undefined' ? '(direct)' : name.replace(/^www\./, ''));
const pageName = (name: string) => (name === 'undefined' ? '(no path)' : name);

export function shape(raw: Raw, now: LocalNow, fetchedAt: Date = new Date()): Stats {
  const yesterdayDate = addDays(now.date, -1);
  const byHour = raw.hours.data.values[raw.event];
  const todayAll = hourly(byHour, now.date);
  const today = todayAll.map((n, h) => (h <= now.hour ? n : null));
  const yesterday = hourly(byHour, yesterdayDate);

  const byDay = raw.days.data.values[raw.event] ?? {};
  const days = [...raw.days.data.series]
    .sort()
    .filter((d) => d <= now.date)
    .slice(-7)
    .map((date) => ({ date, n: byDay[date] ?? 0 }));

  return {
    v: 1,
    fetchedAt: fetchedAt.toISOString(),
    tz: now.tz,
    date: now.date,
    hour: now.hour,
    minute: now.minute,
    hours: { today, yesterday },
    days,
    totals: {
      thisHour: todayAll[now.hour] ?? 0,
      lastHour: now.hour > 0 ? (todayAll[now.hour - 1] ?? 0) : (yesterday[23] ?? 0),
      today: sum(today),
      yesterdayToHour: sum(yesterday.slice(0, now.hour + 1)),
      yesterday: sum(yesterday),
      week: days.reduce((a, d) => a + d.n, 0),
    },
    referrers: rows(raw.referrers, now.date, referrerName),
    pages: rows(raw.pages, now.date, pageName),
  };
}
