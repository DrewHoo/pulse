import { addDays, pad2, type LocalNow } from './time';

// The two Query API endpoints the worker reads both answer in this shape:
// `series` lists the bucket labels in order, `values` maps a segment (the
// event name for /events, a property value for /segmentation) to its count
// per bucket. A `type=unique` call counts visitors instead of views.
export interface Series {
  data: { series: string[]; values: Record<string, Record<string, number>> };
}

// Refreshed every few minutes: the hourly series, yesterday through today.
export interface Fast {
  hours: Series;
  hoursUnique: Series;
}

// Refreshed less often: the week by day, and the lists. Views run the whole
// week (daily); visitors are today only, because uniques don't sum across days.
export interface Slow {
  days: Series;
  daysUnique: Series;
  domains: Series;            // $referring_domain, for the direct and internal rows
  domainsUniqueToday: Series;
  urls: Series;               // full $referrer, outside drewhoover.com only
  urlsUniqueToday: Series;
  pages: Series;              // current_url_path
  pagesUniqueToday: Series;
}

export interface Raw extends Fast, Slow { event: string }

export interface Row { name: string; today: number; visitors: number; week: number }

export interface Stats {
  v: 2;
  fetchedAt: string;
  tz: string;
  date: string;
  hour: number;
  minute: number;
  hours: {
    today: (number | null)[]; yesterday: number[];
    todayVisitors: (number | null)[]; yesterdayVisitors: number[];
  };
  days: { date: string; n: number; visitors: number }[];
  totals: {
    thisHour: number; thisHourVisitors: number; lastHour: number;
    today: number; todayVisitors: number;
    yesterdayToHour: number; yesterday: number; yesterdayVisitors: number;
    week: number;
  };
  referrers: Row[];
  pages: Row[];
}

export const LIST_ROWS = 12;
export const INTERNAL = 'drewhoover.com';

const sum = (xs: (number | null)[]) => xs.reduce<number>((a, x) => a + (x ?? 0), 0);

function hourly(values: Record<string, number> | undefined, date: string): number[] {
  return Array.from({ length: 24 }, (_, h) => values?.[`${date} ${pad2(h)}:00:00`] ?? 0);
}

// Segments that rename to the same row (www.reddit.com/ and reddit.com/)
// merge; their visitors add too, which can double-count a person who came
// by both spellings, a small price for one row.
function rows(
  views: Series, uniqueToday: Series, today: string,
  rename: (name: string) => string, keep: (name: string) => boolean = () => true,
): Row[] {
  const merged = new Map<string, Row>();
  for (const [raw, byDay] of Object.entries(views.data.values)) {
    const week = sum(Object.values(byDay));
    const name = rename(raw);
    if (week === 0 || !keep(name)) continue;
    const row = merged.get(name) ?? { name, today: 0, visitors: 0, week: 0 };
    row.today += byDay[today] ?? 0;
    row.week += week;
    merged.set(name, row);
  }
  for (const [raw, byDay] of Object.entries(uniqueToday.data.values)) {
    const row = merged.get(rename(raw));
    if (row) row.visitors += byDay[today] ?? 0;
  }
  return [...merged.values()];
}

const rank = (rows: Row[]) => rows
  .sort((a, b) => b.today - a.today || b.week - a.week || a.name.localeCompare(b.name))
  .slice(0, LIST_ROWS);

// An event without the property lands in Mixpanel's "undefined" segment. For
// referrers that is a visit with no document.referrer, so it reads as direct.
const domainName = (name: string) => (name === 'undefined' ? '(direct)' : name.replace(/^www\./, ''));
const pageName = (name: string) => (name === 'undefined' ? '(no path)' : name);

// A full outside referrer, as a readable name: no scheme, no www., no
// trailing slash, the path kept so a thread reads as a thread.
export function outsideName(url: string): string {
  let u: URL;
  try { u = new URL(url); } catch { return url; }
  const host = u.hostname.replace(/^www\./, '');
  if (!/^https?:$/.test(u.protocol)) return host || url; // android-app://com.reddit.frontpage/
  const path = u.pathname.replace(/\/+$/, '');
  return host + path;
}

export function shape(raw: Raw, now: LocalNow, fetchedAt: Date = new Date()): Stats {
  const yesterdayDate = addDays(now.date, -1);
  const cut = <T,>(xs: T[]) => xs.map((n, h) => (h <= now.hour ? n : null));
  const todayAll = hourly(raw.hours.data.values[raw.event], now.date);
  const today = cut(todayAll);
  const yesterday = hourly(raw.hours.data.values[raw.event], yesterdayDate);
  const todayVisitorsAll = hourly(raw.hoursUnique.data.values[raw.event], now.date);
  const yesterdayVisitors = hourly(raw.hoursUnique.data.values[raw.event], yesterdayDate);

  const byDay = raw.days.data.values[raw.event] ?? {};
  const byDayUnique = raw.daysUnique.data.values[raw.event] ?? {};
  const days = [...raw.days.data.series]
    .sort()
    .filter((d) => d <= now.date)
    .slice(-7)
    .map((date) => ({ date, n: byDay[date] ?? 0, visitors: byDayUnique[date] ?? 0 }));
  const dayOf = (date: string) => days.find((d) => d.date === date);

  const referrers = rank([
    ...rows(raw.domains, raw.domainsUniqueToday, now.date, domainName, (n) => n === '(direct)' || n === INTERNAL),
    ...rows(raw.urls, raw.urlsUniqueToday, now.date, outsideName),
  ]);

  return {
    v: 2,
    fetchedAt: fetchedAt.toISOString(),
    tz: now.tz,
    date: now.date,
    hour: now.hour,
    minute: now.minute,
    hours: { today, yesterday, todayVisitors: cut(todayVisitorsAll), yesterdayVisitors },
    days,
    totals: {
      thisHour: todayAll[now.hour] ?? 0,
      thisHourVisitors: todayVisitorsAll[now.hour] ?? 0,
      lastHour: now.hour > 0 ? (todayAll[now.hour - 1] ?? 0) : (yesterday[23] ?? 0),
      today: sum(today),
      todayVisitors: dayOf(now.date)?.visitors ?? 0,
      yesterdayToHour: sum(yesterday.slice(0, now.hour + 1)),
      yesterday: sum(yesterday),
      yesterdayVisitors: dayOf(yesterdayDate)?.visitors ?? 0,
      week: days.reduce((a, d) => a + d.n, 0),
    },
    referrers,
    pages: rank(rows(raw.pages, raw.pagesUniqueToday, now.date, pageName)),
  };
}
