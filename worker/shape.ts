import type { Measures } from './measures';
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
  shares: Series;             // the share worker's link previews, by the app that fetched them
  ai: Series;                 // pageviews an AI assistant sent, by utm_source or else $referring_domain (aiOn)
  aiUniqueToday: Series;
  reddit: Series;             // Reddit's fetches of a Streak King link, by URL and hour (redditWhere)
  returning: Returning | null;
  sports?: Series;            // Putting Up Numbers only: its pageviews by the page's `sport`
  sportsUniqueToday?: Series;
}

// Who came back, from one JQL query over the last RETURNING_DAYS (index.ts);
// null when it failed, so the rest of the screen still draws.
export interface Returning {
  today: number;        // today's visitors seen on an earlier day in the window
  week: number;         // the last seven days' visitors seen on two or more of those days
  weekVisitors: number; // the last seven days' visitors
}

export interface Raw extends Fast, Slow { event: string }

export interface Row { name: string; today: number; visitors: number; week: number }

// A link preview is a bot fetching a shared link, so it has no visitors.
export interface ShareRow { name: string; today: number; week: number }

// A link that may have gone up on Reddit: Reddit's fetches of one URL that
// fall within REDDIT_GAP_HOURS of each other, read as one post or comment.
export interface RedditRow {
  at: string;      // the first fetch's hour, "YYYY-MM-DD HH" in the project timezone
  url: string;     // the link as posted, &amp; unescaped
  crawler: number; // redditbot fetches: a link post submitted, or pasted into the submit form
  text: number;    // &amp;-escaped fetches: the link inside a post's or a comment's text
}

export interface Stats {
  v: 5;
  path: PathKey;
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
  // Visitors lead and views follow. A visitor count doesn't sum across
  // buckets (one person in two hours is one visitor that day), so the
  // same-hour comparison with yesterday adds up visitor-hours on both sides,
  // and the week is the average day's visitors.
  totals: {
    thisHour: number; thisHourVisitors: number; lastHour: number; lastHourVisitors: number;
    today: number; todayVisitors: number; todayVisitorHours: number;
    yesterdayToHour: number; yesterdayVisitorHoursToHour: number; yesterday: number; yesterdayVisitors: number;
    week: number; weekVisitorsPerDay: number;
  };
  referrers: Row[];
  pages: Row[];
  shares: ShareRow[];
  ai: Row[];
  reddit: { views: Row; links: RedditRow[] }; // views: every reddit-referred pageview as one row
  returning: Returning | null;
  sports: Row[]; // Putting Up Numbers' sections by sport; empty on any other filter
  measures?: Measures | null; // set by index.ts: Putting Up Numbers' three numbers, null on any other filter or with no answer yet
  staleSince?: string | null; // set by index.ts when a group is the last good copy, the oldest one's fetch time
}

// The picker's filters: every view is one site's pages or everything the
// project records. An allowlist, not a free path, because each filter is its
// own set of Query API calls against the hourly budget (see index.ts).
//
// A filter matches the page's full URL from its host on (`"x" in` is a
// substring test, and the query language has no starts-with), so the blog's
// /blog/ doesn't catch Streak King's /cfb-streak-king/blog/, Breathing Index's
// own domain doesn't mix its / and /about with drewhoover.com's, and a dev
// server's localhost pageviews stay out. `strip` comes off the front of the
// Pages list's paths, where it would say the filter again on every row.
export const PATHS = [
  { key: 'puttingupnumbers', label: 'putting up numbers', url: 'puttingupnumbers.com/', strip: '' },
  { key: 'cfb-streak-king', label: 'streak king', url: 'drewhoover.com/cfb-streak-king/', strip: '/cfb-streak-king' },
  { key: 'hostile-territory', label: 'hostile territory', url: 'drewhoover.com/hostile-territory/', strip: '/hostile-territory' },
  { key: 'breathing-index', label: 'breathing index', url: 'breathingindex.com/', strip: '' },
  { key: 'blog', label: 'blog', url: 'drewhoover.com/blog/', strip: '/blog' },
  { key: 'all', label: 'all', url: null, strip: '' },
] as const;
export type PathKey = (typeof PATHS)[number]['key'];
export const DEFAULT_PATH: PathKey = 'puttingupnumbers';
export const isPathKey = (k: string | null): k is PathKey => PATHS.some((p) => p.key === k);

// The URL a filter's pageviews contain, or null for all.
export const pathUrl = (key: PathKey): string | null => PATHS.find((p) => p.key === key)?.url ?? null;

// The Query API's `where` for a filter's pageviews, or none for all.
export function pathWhere(key: PathKey): string | undefined {
  const url = pathUrl(key);
  return url ? `"${url}" in properties["$current_url"]` : undefined;
}

// A page under the filter, without the filter's own path: /cfb-streak-king/
// reads as / and /cfb-streak-king/games/ as /games/.
export function pageName(name: string, key: PathKey = 'all'): string {
  if (name === 'undefined') return '(no path)';
  const strip = PATHS.find((p) => p.key === key)?.strip ?? '';
  return strip && name.startsWith(`${strip}/`) ? name.slice(strip.length) : name;
}

export const LIST_ROWS = 12;

// PUN's `sport` as its section's name. The home's pageviews carry one too, so
// 'home' is only a fallback for a page that registers none.
const SPORTS: Record<string, string> = {
  nba: 'NBA', wnba: 'WNBA', nfl: 'NFL', nhl: 'NHL', cfb: 'college football', soccer: 'soccer',
  mcbb: "men's college basketball", wcbb: "women's college basketball",
};
export const sportName = (segment: string): string => (segment === 'undefined' ? 'home' : SPORTS[segment] ?? segment);
// Drew's own domains. A referrer from one is a reader moving between his
// pages, listed by domain; any other referrer is listed by its full URL.
export const INTERNAL = ['drewhoover.com', 'puttingupnumbers.com', 'breathingindex.com'];

// The site a filter's pages are on, for the header.
export const siteName = (key: PathKey): string => {
  const url = pathUrl(key);
  return url ? url.slice(0, url.indexOf('/')) : 'drewhoover.com';
};

// Who counts: real users only, as the project's VisitorType custom property
// (5925272) sorts them. Not one of Drew's devices (his browsers' device ids,
// or the agent test browsers in North Haven), and not a bot (a bot in the id
// or the user agent, a framed load, an 800x600 screen, Linux at 1920x1080
// from Ashburn or nowhere, or the headless Mac at 1440x900 that crawled PUN
// from 2026-11-03). The Query API can't read a custom property (a filter on
// one matches nothing), so the rules are written out here, once as a
// segmentation `where` and once as JQL's test. A change to VisitorType in
// Mixpanel has to land here too.
export const DREW_DEVICES = [
  '$device:ae22fd94-5828-45fb-98e5-23b169eb81de', '$device:4513f587-5d83-432a-b833-6f10cf4de1c9',
  '$device:b29ebd6b-5a2d-4cb6-b159-9f95d1b8c1f6', '$device:8d931490-3f86-48af-92c3-f3f4f0c75ccf',
  '$device:c6939433-8d2f-407d-9416-a32a7b3f8ea6', '$device:e25cd636-ae66-4d9e-95a4-9ec046ee3959',
];
export const DREW_CITY = 'North Haven';
export const BOT_ID = ['bot', 'crawler'];
export const BOT_AGENT = [
  'bot', 'crawl', 'spider', 'slurp', 'headless', 'externalagent', 'externalhit', 'lighthouse',
  'python', 'curl/', 'wget', 'phantom', 'puppeteer', 'playwright', 'selenium',
];

const prop = (name: string) => `properties["${name}"]`;
const anyIn = (words: string[], text: string) => words.map((w) => `"${w}" in lower(${text})`).join(' or ');
const screen = (w: number, h: number) => `${prop('$screen_width')} == ${w} and ${prop('$screen_height')} == ${h}`;
export const realWhere = `not (${[
  `${prop('$distinct_id')} in ${JSON.stringify(DREW_DEVICES)}`,
  `${prop('$city')} == "${DREW_CITY}"`,
  `(defined(${prop('$distinct_id')}) and (${anyIn(BOT_ID, prop('$distinct_id'))}))`,
  `(defined(${prop('user_agent')}) and (${anyIn(BOT_AGENT, prop('user_agent'))}))`,
  `${prop('framed')} == true`,
  `(${screen(800, 600)})`,
  `(${prop('$os')} == "Linux" and ${screen(1920, 1080)} and (not defined(${prop('$city')}) or ${prop('$city')} == "Ashburn"))`,
  `(${prop('$os')} == "Mac OS X" and ${screen(1440, 900)})`,
].join(' or ')})`;

// The same test for JQL, which gets the lists as params (index.ts).
export const REAL_JQL = `function real(e) {
  var p = e.properties, id = String(e.distinct_id || ''), ua = String(p.user_agent || '').toLowerCase();
  var has = function (text, words) { for (var i = 0; i < words.length; i++) if (text.indexOf(words[i]) >= 0) return true; return false; };
  if (params.drewDevices.indexOf(id) >= 0 || p.$city === params.drewCity) return false;
  if (has(id.toLowerCase(), params.botId) || has(ua, params.botAgent) || p.framed === true) return false;
  if (p.$screen_width === 800 && p.$screen_height === 600) return false;
  if (p.$os === 'Linux' && p.$screen_width === 1920 && p.$screen_height === 1080 && (!p.$city || p.$city === 'Ashburn')) return false;
  if (p.$os === 'Mac OS X' && p.$screen_width === 1440 && p.$screen_height === 900) return false;
  return true;
}`;

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
  .sort((a, b) => b.visitors - a.visitors || b.today - a.today || b.week - a.week || a.name.localeCompare(b.name))
  .slice(0, LIST_ROWS);

// An event without the property lands in Mixpanel's "undefined" segment. For
// referrers that is a visit with no document.referrer, so it reads as direct.
const domainName = (name: string) => (name === 'undefined' ? '(direct)' : name.replace(/^www\./, ''));

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

// The share worker (cfb-streak-king's workers/share) reports one event per
// link preview, its `agent` the app that fetched the link. A chat or social
// app fetching one means someone pasted the link there, which the pageviews
// can't show: the click that follows arrives with no referrer and reads as
// direct. Search crawlers fetch links too, and aren't shares.
const SHARE_APPS: Record<string, string> = {
  imessage: 'iMessage', discord: 'Discord', slack: 'Slack', whatsapp: 'WhatsApp', telegram: 'Telegram',
  facebook: 'Facebook', twitter: 'X', reddit: 'Reddit', linkedin: 'LinkedIn', bluesky: 'Bluesky', mastodon: 'Mastodon',
};

// AI assistants. ChatGPT and Perplexity send no referrer and tag the link
// instead (utm_source=chatgpt.com, utm_source=perplexity), and the tag rides
// along on the pageviews after the landing, so they read as internal; others
// send a referrer. One segment per pageview: the tag if there is one, else
// the referring domain (aiOn), so a visit carrying both counts once.
const AI_SOURCES: [RegExp, string][] = [
  [/^(chatgpt(\.com)?|chat\.openai\.com|openai)$/, 'ChatGPT'],
  [/^(www\.)?perplexity(\.ai)?$/, 'Perplexity'],
  [/^claude(\.ai)?$|^anthropic$/, 'Claude'],
  [/^(gemini(\.google\.com)?|bard\.google\.com)$/, 'Gemini'],
  [/^(copilot(\.com|\.microsoft\.com)?)$/, 'Copilot'],
  [/^(grok(\.com)?|x\.ai)$/, 'Grok'],
  [/^(chat\.)?deepseek(\.com)?$/, 'DeepSeek'],
  [/^(www\.)?meta\.ai$/, 'Meta AI'],
  [/^(chat\.)?mistral(\.ai)?$/, 'Le Chat'],
  [/^(www\.)?you\.com$/, 'You.com'],
  [/^(www\.)?phind(\.com)?$/, 'Phind'],
];
export const AI_DOMAINS = [
  'chatgpt.com', 'chat.openai.com', 'perplexity.ai', 'www.perplexity.ai', 'claude.ai', 'gemini.google.com',
  'copilot.microsoft.com', 'copilot.com', 'grok.com', 'chat.deepseek.com', 'www.meta.ai', 'chat.mistral.ai',
  'you.com', 'www.phind.com',
];
export const aiOn = 'if(defined(properties["utm_source"]), properties["utm_source"], properties["$referring_domain"])';
export const aiWhere =
  `defined(properties["utm_source"]) or properties["$referring_domain"] in ${JSON.stringify(AI_DOMAINS)}`;
export const aiName = (segment: string): string =>
  AI_SOURCES.find(([re]) => re.test(segment.toLowerCase()))?.[1] ?? '';

// Reddit leaves two marks on the share worker's fetches (see the cfb-streak-king
// memory notes): its own crawler (agent reddit) fetches a link post's URL on
// submit, and often minutes earlier when the URL is pasted into the form, so a
// fetch with no post can be a draft; and a URL in a post's or comment's text is
// fetched HTML-escaped, `&amp;` for `&`, by an unnamed bot. A comment can also
// draw no fetch at all, so the list is leads to look up, not a count of posts.
// Only board URLs the worker rewords report a fetch; a prerendered page doesn't.
export const redditWhere =
  'properties["agent"] == "reddit" or (properties["agent"] == "other-bot" and "&amp;" in properties["url"])';
export const REDDIT_GAP_HOURS = 2;

// The link as written: &amp; unescaped, and the punctuation a markdown link
// or a sentence leaves stuck to its end trimmed.
export function redditLink(url: string): string {
  return url.replace(/&amp;/g, '&').replace(/[),.]+$/, '');
}

function redditRows(fetches: Series): RedditRow[] {
  const byUrl = new Map<string, { hour: string; crawler: number; text: number }[]>();
  for (const [url, byHour] of Object.entries(fetches.data.values)) {
    if (url === 'undefined') continue;
    const link = redditLink(url);
    const escaped = url.includes('&amp;');
    const hours = byUrl.get(link) ?? [];
    for (const [hour, n] of Object.entries(byHour)) {
      if (n > 0) hours.push({ hour, crawler: escaped ? 0 : n, text: escaped ? n : 0 });
    }
    byUrl.set(link, hours);
  }
  const at = (label: string) => Date.parse(`${label.slice(0, 13).replace(' ', 'T')}:00:00Z`);
  const out: RedditRow[] = [];
  for (const [url, hours] of byUrl) {
    hours.sort((a, b) => a.hour.localeCompare(b.hour));
    let row: RedditRow | null = null;
    let last = 0;
    for (const h of hours) {
      const t = at(h.hour);
      if (!row || t - last > REDDIT_GAP_HOURS * 3600_000) {
        row = { at: h.hour.slice(0, 13), url, crawler: 0, text: 0 };
        out.push(row);
      }
      row.crawler += h.crawler;
      row.text += h.text;
      last = t;
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at) || a.url.localeCompare(b.url)).slice(0, LIST_ROWS);
}

// Every reddit-referred pageview as one row: www., old., out., the app.
function redditViews(domains: Series, uniqueToday: Series, today: string): Row {
  const reddit = (name: string) => (/(^|\.)reddit\.com$|^com\.reddit\./.test(name) ? 'reddit' : '');
  const [row] = rows(domains, uniqueToday, today, reddit, (n) => n === 'reddit');
  return row ?? { name: 'reddit', today: 0, visitors: 0, week: 0 };
}

function shareRows(views: Series, today: string): ShareRow[] {
  const out: ShareRow[] = [];
  for (const [agent, byDay] of Object.entries(views.data.values)) {
    const name = SHARE_APPS[agent];
    const week = sum(Object.values(byDay));
    if (!name || week === 0) continue;
    out.push({ name, today: byDay[today] ?? 0, week });
  }
  return out.sort((a, b) => b.today - a.today || b.week - a.week || a.name.localeCompare(b.name));
}

export function shape(raw: Raw, now: LocalNow, path: PathKey = 'all', fetchedAt: Date = new Date()): Stats {
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
    ...rows(raw.domains, raw.domainsUniqueToday, now.date, domainName, (n) => n === '(direct)' || INTERNAL.includes(n)),
    ...rows(raw.urls, raw.urlsUniqueToday, now.date, outsideName),
  ]);

  return {
    v: 5,
    path,
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
      lastHourVisitors: now.hour > 0 ? (todayVisitorsAll[now.hour - 1] ?? 0) : (yesterdayVisitors[23] ?? 0),
      today: sum(today),
      todayVisitors: dayOf(now.date)?.visitors ?? 0,
      todayVisitorHours: sum(todayVisitorsAll.slice(0, now.hour + 1)),
      yesterdayToHour: sum(yesterday.slice(0, now.hour + 1)),
      yesterdayVisitorHoursToHour: sum(yesterdayVisitors.slice(0, now.hour + 1)),
      yesterday: sum(yesterday),
      yesterdayVisitors: dayOf(yesterdayDate)?.visitors ?? 0,
      week: days.reduce((a, d) => a + d.n, 0),
      weekVisitorsPerDay: Math.round(days.reduce((a, d) => a + d.visitors, 0) / Math.max(1, days.length)),
    },
    referrers,
    pages: rank(rows(raw.pages, raw.pagesUniqueToday, now.date, (n) => pageName(n, path))),
    shares: shareRows(raw.shares, now.date),
    ai: rank(rows(raw.ai, raw.aiUniqueToday, now.date, aiName, (n) => n !== '')),
    reddit: { views: redditViews(raw.domains, raw.domainsUniqueToday, now.date), links: redditRows(raw.reddit) },
    returning: raw.returning ?? null,
    sports: raw.sports && raw.sportsUniqueToday
      ? rank(rows(raw.sports, raw.sportsUniqueToday, now.date, sportName))
      : [],
  };
}
