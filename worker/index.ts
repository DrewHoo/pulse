// The pulse API: one JSON endpoint in front of Mixpanel's Query API, so the
// service account never leaves Cloudflare and the static page on GitHub Pages
// holds nothing secret. Routed at drewhoover.com/pulse/api/*, same-origin with
// the page, so no CORS.
//
//   GET /pulse/api/stats   bearer token (or ?k=), the shaped stats JSON
//   GET /pulse/api/health  no auth, whether the secrets are set
//
// Every pageview call counts real users only (shape.ts, realWhere): no bots
// and none of Drew's own devices. The link previews stay as they are, since a
// preview is a bot's fetch by definition.
//
// Mixpanel allows 60 Query API calls an hour per project. A full refresh is
// fifteen calls (seventeen for Putting Up Numbers, whose sports are two more),
// so the raw answers sit in the edge cache in two groups: the hourly series
// (2 calls) for FAST_SECONDS and everything else for SLOW_SECONDS. Polled
// without pause that is 24 + 26 calls an hour (24 + 30 for PUN), and every
// client, page or widget, reads the same copies. Each path filter
// (?path=, shape.ts PATHS) is its own pair of groups, so one filter polled
// all hour fits the budget and two polled at once do not: the page polls only
// the filter it shows.
//
// Putting Up Numbers' three numbers (measures.ts) are one more JQL call, in a
// group of their own that refreshes every MEASURES_SECONDS: they compare
// months, so they spend about four calls a day and leave the hourly sums above
// where they were. A failed refresh keeps the last answer for MEASURES_RETRY
// rather than asking again on every poll.
//
//   GET /pulse/api/stats?path=puttingupnumbers|cfb-streak-king|…|all   (default puttingupnumbers)

import {
  aiOn, aiWhere, BOT_AGENT, BOT_ID, DEFAULT_PATH, DREW_CITY, DREW_DEVICES, INTERNAL, REAL_JQL, realWhere, redditWhere,
  isPathKey, pathUrl, pathWhere, shape, type Returning, type Fast, type PathKey, type Raw, type Series, type Slow,
} from './shape';
import { ACTS, MEASURE_DAYS, MEASURES_JQL, measures, RESOLVE_SECONDS, SESSION_MINUTES, type MeasureDays } from './measures';
import { addDays, localNow, offsetMs, type LocalNow } from './time';

export interface Env {
  MIXPANEL_SERVICE_ACCOUNT?: string; // secret: "<username>:<secret>" of a Mixpanel service account
  PULSE_TOKEN?: string;              // secret: the bearer token the page and the widget send
  MIXPANEL_PROJECT_ID: string;
  MIXPANEL_TZ: string;               // the project's timezone, as set in Mixpanel
  MIXPANEL_API: string;              // https://mixpanel.com (https://eu.mixpanel.com for EU residency)
  PAGEVIEW_EVENT: string;
  UNFURL_EVENT: string;              // the share worker's link-preview event
}

const FAST_SECONDS = 300;
const SLOW_SECONDS = 1800;
const MEASURES_SECONDS = 21_600;
const MEASURES_RETRY = 1800;
const RAW_VERSION = 6; // bump with any change to what is fetched, so a stale cached group is skipped

const JSON_TYPE = 'application/json; charset=utf-8';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': JSON_TYPE, 'cache-control': 'no-store', ...headers },
  });

const enc = new TextEncoder();
function sameToken(given: string, expected: string): boolean {
  const a = enc.encode(given);
  const b = enc.encode(expected);
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

function bearer(req: Request): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '');
  return m?.[1]?.trim() || null;
}

// Mixpanel also caps a project at five concurrent queries, so every call of a
// refresh goes through one small pool.
type Run = <T>(job: () => Promise<T>) => Promise<T>;
function pool(size: number): Run {
  let active = 0;
  const waiting: (() => void)[] = [];
  const next = () => { active--; waiting.shift()?.(); };
  return async (job) => {
    if (active >= size) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try { return await job(); } finally { next(); }
  };
}

// `limited` flips at the first 429 of a refresh, and the calls still queued
// in the pool then fail without asking: Mixpanel seems to count a refused
// call against the hour too, so firing the rest would only keep it shut.
interface Client { env: Env; run: Run; limited: boolean }

export class MixpanelError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const RATE_LIMITED = 429;

async function call(c: Client, path: string, init: () => Promise<Response>): Promise<Response> {
  const res = await c.run(async () => {
    if (c.limited) throw new MixpanelError(RATE_LIMITED, `mixpanel ${path}: skipped after a 429`);
    return init();
  });
  if (res.status === RATE_LIMITED) c.limited = true;
  return res;
}

async function query(c: Client, path: string, params: Record<string, string>): Promise<Series> {
  const { env } = c;
  const url = new URL(`${env.MIXPANEL_API}/api/query/${path}`);
  url.searchParams.set('project_id', env.MIXPANEL_PROJECT_ID);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await call(c, path, () => fetch(url, {
    headers: { authorization: `Basic ${btoa(env.MIXPANEL_SERVICE_ACCOUNT!)}`, accept: 'application/json' },
  }));
  if (!res.ok) throw new MixpanelError(res.status, `mixpanel ${path} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// A filter's pageviews, real users only.
const realOnly = (where?: string) => (where ? `(${where}) and ${realWhere}` : realWhere);

// Pageview totals by hour or day. /events can't filter, so they come from
// /segmentation with no `on`, which answers in the same shape (values keyed
// by the event name).
function totals(c: Client, type: string, unit: string, from_date: string, to_date: string, where: string) {
  return query(c, 'segmentation', { event: c.env.PAGEVIEW_EVENT, type, unit, from_date, to_date, where });
}

async function fetchFast(c: Client, today: string, where: string): Promise<Fast> {
  const from_date = addDays(today, -1);
  const [hours, hoursUnique] = await Promise.all([
    totals(c, 'general', 'hour', from_date, today, where),
    totals(c, 'unique', 'hour', from_date, today, where),
  ]);
  return { hours, hoursUnique };
}

// Who came back. The segmentation endpoints count visitors one bucket at a
// time, and the retention endpoint's cohorts aren't first visits, so a
// visitor's days come from JQL: every pageview in the window, grouped by
// person into the set of project-local days they were on, reduced to three
// counts, real users only (REAL_JQL). A failure is null, not an error, so the
// screen still draws.
const RETURNING_DAYS = 30;
const RETURNING_JQL = `${REAL_JQL}
function main() {
  return Events({ from_date: params.from, to_date: params.to, event_selectors: [{ event: params.event }] })
    .filter(function (e) { return real(e) && (!params.url || String(e.properties.$current_url || '').indexOf(params.url) >= 0); })
    .groupByUser(function (days, events) {
      days = days || {};
      for (var i = 0; i < events.length; i++) days[new Date(events[i].time + params.offset).toISOString().slice(0, 10)] = 1;
      return days;
    })
    .reduce(function (accs, users) {
      var out = { today: 0, week: 0, weekVisitors: 0 };
      for (var a = 0; a < accs.length; a++) {
        out.today += accs[a].today; out.week += accs[a].week; out.weekVisitors += accs[a].weekVisitors;
      }
      for (var u = 0; u < users.length; u++) {
        var days = Object.keys(users[u].value), onToday = false, before = false, inWeek = 0;
        for (var d = 0; d < days.length; d++) {
          if (days[d] === params.to) onToday = true; else before = true;
          if (days[d] >= params.weekStart) inWeek++;
        }
        if (onToday && before) out.today++;
        if (inWeek > 0) out.weekVisitors++;
        if (inWeek > 1) out.week++;
      }
      return out;
    });
}`;

async function fetchReturning(c: Client, today: string, url: string | null): Promise<Returning | null> {
  const { env } = c;
  const body = new URLSearchParams({
    project_id: env.MIXPANEL_PROJECT_ID,
    script: RETURNING_JQL,
    params: JSON.stringify({
      from: addDays(today, -(RETURNING_DAYS - 1)), to: today, weekStart: addDays(today, -6),
      event: env.PAGEVIEW_EVENT, url, offset: offsetMs(env.MIXPANEL_TZ),
      drewDevices: DREW_DEVICES, drewCity: DREW_CITY, botId: BOT_ID, botAgent: BOT_AGENT,
    }),
  });
  try {
    const res = await call(c, 'jql', () => fetch(`${env.MIXPANEL_API}/api/query/jql`, {
      method: 'POST',
      headers: { authorization: `Basic ${btoa(env.MIXPANEL_SERVICE_ACCOUNT!)}`, accept: 'application/json' },
      body,
    }));
    if (!res.ok) return null;
    const answer = await res.json<unknown>();
    if (!Array.isArray(answer)) return null;
    const out = answer[0] as Returning | undefined; // no pageviews in the window: an empty list
    return out && typeof out.today === 'number' ? out : { today: 0, week: 0, weekVisitors: 0 };
  } catch {
    return null;
  }
}

// The three numbers' days. A failure throws, unlike who came back: the group
// keeps its last good copy, and the screen draws without the numbers if it has
// none.
async function fetchMeasures(c: Client, today: string, url: string): Promise<MeasureDays> {
  const { env } = c;
  const body = new URLSearchParams({
    project_id: env.MIXPANEL_PROJECT_ID,
    script: MEASURES_JQL,
    params: JSON.stringify({
      from: addDays(today, -(MEASURE_DAYS - 1)), to: today, url, event: env.PAGEVIEW_EVENT, acts: ACTS,
      offset: offsetMs(env.MIXPANEL_TZ), sessionMs: SESSION_MINUTES * 60_000, resolveMs: RESOLVE_SECONDS * 1000,
      drewDevices: DREW_DEVICES, drewCity: DREW_CITY, botId: BOT_ID, botAgent: BOT_AGENT,
    }),
  });
  const res = await call(c, 'jql', () => fetch(`${env.MIXPANEL_API}/api/query/jql`, {
    method: 'POST',
    headers: { authorization: `Basic ${btoa(env.MIXPANEL_SERVICE_ACCOUNT!)}`, accept: 'application/json' },
    body,
  }));
  if (!res.ok) throw new MixpanelError(res.status, `mixpanel jql ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const answer = await res.json<unknown>();
  if (!Array.isArray(answer)) throw new Error('mixpanel jql: the answer is not a list');
  return (answer[0] ?? {}) as MeasureDays; // no events in the window: an empty list
}

async function fetchSlow(c: Client, today: string, path: string, url: string | null, sports: boolean): Promise<Slow> {
  const event = c.env.PAGEVIEW_EVENT;
  const weekStart = addDays(today, -6);
  const events = (type: string) => totals(c, type, 'day', weekStart, today, path);
  const segmentation = (on: string, type: string, from_date: string, where = path, ev = event, unit = 'day') =>
    query(c, 'segmentation', {
      event: ev, type, on, from_date, to_date: today, unit, limit: '60', ...(where ? { where } : {}),
    });
  const both = (a: string, b: string) => `(${a}) and (${b})`;
  const outside = both(path, `defined(properties["$referrer"]) and not (properties["$referring_domain"] in ${JSON.stringify(INTERNAL)})`);
  const ai = both(path, aiWhere);
  const none = Promise.resolve(undefined);
  const [
    days, daysUnique, domains, domainsUniqueToday, urls, urlsUniqueToday, pages, pagesUniqueToday, shares,
    aiViews, aiUniqueToday, reddit, returning, sportViews, sportsUniqueToday,
  ] = await Promise.all([
      events('general'),
      events('unique'),
      segmentation('properties["$referring_domain"]', 'general', weekStart),
      segmentation('properties["$referring_domain"]', 'unique', today),
      segmentation('properties["$referrer"]', 'general', weekStart, outside),
      segmentation('properties["$referrer"]', 'unique', today, outside),
      segmentation('properties["current_url_path"]', 'general', weekStart),
      segmentation('properties["current_url_path"]', 'unique', today),
      segmentation('properties["agent"]', 'general', weekStart, '', c.env.UNFURL_EVENT), // no path: a preview isn't a pageview
      segmentation(aiOn, 'general', weekStart, ai),
      segmentation(aiOn, 'unique', today, ai),
      segmentation('properties["url"]', 'general', weekStart, redditWhere, c.env.UNFURL_EVENT, 'hour'),
      fetchReturning(c, today, url),
      sports ? segmentation('properties["sport"]', 'general', weekStart) : none,
      sports ? segmentation('properties["sport"]', 'unique', today) : none,
    ]);
  return {
    days, daysUnique, domains, domainsUniqueToday, urls, urlsUniqueToday, pages, pagesUniqueToday, shares,
    ai: aiViews, aiUniqueToday, reddit, returning,
    ...(sportViews && sportsUniqueToday ? { sports: sportViews, sportsUniqueToday } : {}),
  };
}

// A raw group from the edge cache, or fetched and stored for `ttl`. The key
// carries the project-local date so a group from before midnight is not read
// as today's.
//
// Each fetched group is also kept as the day's last good copy. When a fetch
// fails, or Mixpanel answered 429 within BACKOFF_SECONDS (a marker for the
// whole project, since the limit is the project's), the last good copy is
// served with the time it was fetched, and a 429 sends no call at all until
// the marker expires: an open page polling every five minutes would
// otherwise spend every refresh on refusals. With `retry`, any failure also
// stands as the answer for that long, null if there is no copy, so a query
// that keeps failing costs one call a `retry`, not one a poll.
const BACKOFF_SECONDS = 600;

interface Kept<T> { at: string; value: T }
type Group<T> = { value: T; hit: boolean; staleSince: string | null };

const cacheKey = (name: string, date?: string) =>
  new Request(`https://pulse-cache.invalid/${name}?v=${RAW_VERSION}${date ? `&d=${date}` : ''}`);
const stored = (body: unknown, ttl: number) => new Response(JSON.stringify(body), {
  headers: { 'content-type': JSON_TYPE, 'cache-control': `public, max-age=${ttl}` },
});

export class RateLimited extends Error {
  constructor(readonly until: string) { super(`Mixpanel's hourly query limit is used up; trying again after ${until}`); }
}

async function cachedGroup<T>(
  ctx: ExecutionContext, name: string, now: LocalNow, ttl: number, load: () => Promise<T>, retry?: number,
): Promise<Group<T>> {
  const fresh = cacheKey(name, now.date);
  const keep = cacheKey(`last-${name}`, now.date);
  const backoff = cacheKey('backoff');
  const hit = await caches.default.match(fresh);
  if (hit) return { value: await hit.json<T>(), hit: true, staleSince: null };

  const lastGood = async () => {
    const kept = await caches.default.match(keep);
    return kept ? await kept.json<Kept<T>>() : null;
  };
  const marker = await caches.default.match(backoff);
  if (marker) {
    const { until } = await marker.json<{ until: string }>();
    const last = await lastGood();
    if (last) return { value: last.value, hit: true, staleSince: last.at };
    throw new RateLimited(until);
  }

  try {
    const value = await load();
    ctx.waitUntil(Promise.all([
      caches.default.put(fresh, stored(value, ttl)),
      caches.default.put(keep, stored({ at: new Date().toISOString(), value } satisfies Kept<T>, 86_400)),
    ]));
    return { value, hit: false, staleSince: null };
  } catch (e) {
    const limited = e instanceof MixpanelError && e.status === RATE_LIMITED;
    const until = new Date(Date.now() + BACKOFF_SECONDS * 1000).toISOString();
    if (limited) ctx.waitUntil(caches.default.put(backoff, stored({ until }, BACKOFF_SECONDS)));
    const last = await lastGood();
    if (retry) ctx.waitUntil(caches.default.put(fresh, stored(last?.value ?? null, retry)));
    if (last) return { value: last.value, hit: false, staleSince: last.at };
    throw limited ? new RateLimited(until) : e;
  }
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/pulse\/api/, '').replace(/\/$/, '') || '/';
    const configured = Boolean(env.MIXPANEL_SERVICE_ACCOUNT && env.PULSE_TOKEN);

    if (path === '/health') return json({ ok: true, configured });
    if (path !== '/stats') return json({ error: 'not found' }, 404);
    if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405);
    if (!configured) {
      return json({ error: 'worker not configured: set the PULSE_TOKEN and MIXPANEL_SERVICE_ACCOUNT secrets' }, 503);
    }
    const given = bearer(req) ?? url.searchParams.get('k');
    if (!given || !sameToken(given, env.PULSE_TOKEN!)) return json({ error: 'unauthorized' }, 401);

    const asked = url.searchParams.get('path');
    if (asked !== null && !isPathKey(asked)) return json({ error: `unknown path filter: ${asked}` }, 400);
    const pathKey: PathKey = asked ?? DEFAULT_PATH;
    const where = realOnly(pathWhere(pathKey));

    const now = localNow(env.MIXPANEL_TZ);
    const client: Client = { env, run: pool(4), limited: false };
    let raw: Raw;
    let cache: string;
    let staleSince: string | null;
    let days: MeasureDays | null = null;
    try {
      const [fast, slow, measured] = await Promise.all([
        cachedGroup(ctx, `fast-${pathKey}`, now, FAST_SECONDS, () => fetchFast(client, now.date, where)),
        cachedGroup(ctx, `slow-${pathKey}`, now, SLOW_SECONDS, () => fetchSlow(client, now.date, where, pathUrl(pathKey), pathKey === 'puttingupnumbers')),
        // never the screen's failure, and never what its stale note reports: the group is hours old by design
        pathKey === 'puttingupnumbers'
          ? cachedGroup<MeasureDays | null>(ctx, 'measures', now, MEASURES_SECONDS, () => fetchMeasures(client, now.date, pathUrl(pathKey)!), MEASURES_RETRY).catch(() => null)
          : null,
      ]);
      days = measured?.value ?? null;
      raw = { event: env.PAGEVIEW_EVENT, ...fast.value, ...slow.value };
      const state = (g: Group<unknown>) => (g.staleSince ? 'stale' : g.hit ? 'hit' : 'miss');
      cache = `fast=${state(fast)} slow=${state(slow)}`;
      staleSince = [fast.staleSince, slow.staleSince].filter((t): t is string => t !== null).sort()[0] ?? null;
    } catch (e) {
      if (e instanceof RateLimited) return json({ error: e.message, retryAfter: e.until }, 503);
      return json({ error: e instanceof Error ? e.message : String(e) }, 502);
    }
    return json({ ...shape(raw, now, pathKey), measures: days && measures(days, now.date), staleSince }, 200, { 'x-pulse-cache': cache });
  },
} satisfies ExportedHandler<Env>;
