// The pulse API: two JSON endpoints in front of Mixpanel, so the service
// account never leaves Cloudflare and the static page on GitHub Pages holds
// nothing secret. Routed at drewhoover.com/pulse/api/*, same-origin with the
// page, so no CORS.
//
//   GET /pulse/api/stats     bearer token (or ?k=), the numbers screen's JSON
//   GET /pulse/api/visitors  bearer token (or ?k=), the visitors screen's JSON
//   GET /pulse/api/health    no auth, whether the secrets are set
//
// Both screens count from Mixpanel's raw export, one UTC day a call, real
// users only (shape.ts, realWhere): no bots and none of Drew's own devices.
// Each day is a cached group, today's for TODAY_SECONDS and a finished day's
// for FINISHED_DAY_SECONDS, and both screens and every filter read the same
// copies. A call over four days took 35 seconds on 2026-11-17 where a day
// takes 3, hence a day a call.
//
// Mixpanel lists 60 calls an hour for the export and 60 for the Query API, and
// the refusals of 2026-11-17 read as one count of 60 for both
// (specs/visitors.spec.md, "What the build changed"), so they're budgeted
// together. Polled without pause, today's day is 12 calls an hour, the
// finished days about eight more a day, and switching filters costs nothing.
// The Query API keeps what the export can't answer:
//
//   - the link previews (2 calls each SLOW_SECONDS, 4 an hour), since the share
//     worker's events are a bot's and the export's days hold only real users'
//   - Putting Up Numbers' three numbers (measures.ts), one JQL call over 56
//     days each MEASURES_SECONDS, about four a day
//
// A failed refresh of either keeps the last answer for its retry rather than
// asking again on every poll.
//
//   GET /pulse/api/stats?path=puttingupnumbers|cfb-streak-king|…|all   (default puttingupnumbers)

import {
  BOT_AGENT, BOT_ID, DEFAULT_PATH, DREW_CITY, DREW_DEVICES, isPathKey, pathUrl, previewsOf, realWhere, redditWhere,
  type PathKey, type Previews, type Series,
} from './shape';
import { ACTS, MEASURE_DAYS, MEASURES_JQL, measures, RESOLVE_SECONDS, SESSION_MINUTES, type MeasureDays } from './measures';
import { numbersOf, WEEK_HOURS } from './numbers';
import { addDays, localNow, offsetMs, type LocalNow } from './time';
import { exportDays, landingsFrom, readExport, visitorsOf, type SiteEvent } from './visitors';

export interface Env {
  MIXPANEL_SERVICE_ACCOUNT?: string; // secret: "<username>:<secret>" of a Mixpanel service account
  PULSE_TOKEN?: string;              // secret: the bearer token the page and the widget send
  MIXPANEL_PROJECT_ID: string;
  MIXPANEL_TZ: string;               // the project's timezone, as set in Mixpanel
  MIXPANEL_API: string;              // https://mixpanel.com (https://eu.mixpanel.com for EU residency)
  MIXPANEL_EXPORT: string;           // https://data.mixpanel.com (https://data-eu.mixpanel.com for EU residency)
  PAGEVIEW_EVENT: string;
  UNFURL_EVENT: string;              // the share worker's link-preview event
}

const TODAY_SECONDS = 300;
const FINISHED_DAY_SECONDS = 86_400;
const SLOW_SECONDS = 1800;
const PREVIEWS_RETRY = 1800;
const MEASURES_SECONDS = 21_600;
const MEASURES_RETRY = 1800;
const EXPORT_AT_ONCE = 2;
const RAW_VERSION = 7; // bump with any change to what is fetched, so a stale cached group is skipped

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

// Every call to Mixpanel: the service account's header, a place in the pool,
// and a refusal thrown with what Mixpanel said.
async function ask(c: Client, path: string, url: string | URL, init: RequestInit = {}, accept = 'application/json'): Promise<Response> {
  const headers = { authorization: `Basic ${btoa(c.env.MIXPANEL_SERVICE_ACCOUNT!)}`, accept };
  const res = await call(c, path, () => fetch(url, { ...init, headers }));
  if (!res.ok) throw new MixpanelError(res.status, `mixpanel ${path} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res;
}

async function query(c: Client, path: string, params: Record<string, string>): Promise<Series> {
  const { env } = c;
  const url = new URL(`${env.MIXPANEL_API}/api/query/${path}`);
  url.searchParams.set('project_id', env.MIXPANEL_PROJECT_ID);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return (await ask(c, path, url)).json();
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
  const res = await ask(c, 'jql', `${env.MIXPANEL_API}/api/query/jql`, { method: 'POST', body });
  const answer = await res.json<unknown>();
  if (!Array.isArray(answer)) throw new Error('mixpanel jql: the answer is not a list');
  return (answer[0] ?? {}) as MeasureDays; // no events in the window: an empty list
}

// One UTC day of browsers' events from the raw export, real users only: the
// export's `where` takes the same expression the segmentation calls do.
async function fetchDay(c: Client, date: string): Promise<SiteEvent[]> {
  const { env } = c;
  const url = new URL(`${env.MIXPANEL_EXPORT}/api/2.0/export`);
  const params = { project_id: env.MIXPANEL_PROJECT_ID, from_date: date, to_date: date, where: realWhere, time_in_ms: 'true' };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return readExport(await (await ask(c, 'export', url, {}, 'text/plain')).text());
}

// The link previews, every site's: a preview isn't a pageview, so no filter
// cuts them. The apps' previews by day over the week, and Reddit's fetches by hour.
async function fetchPreviews(c: Client, today: string): Promise<Previews> {
  const from_date = addDays(today, -6);
  const segmentation = (params: Record<string, string>) => query(c, 'segmentation', {
    event: c.env.UNFURL_EVENT, type: 'general', from_date, to_date: today, limit: '60', ...params,
  });
  const [shares, reddit] = await Promise.all([
    segmentation({ on: 'properties["agent"]', unit: 'day' }),
    segmentation({ on: 'properties["url"]', unit: 'hour', where: redditWhere }),
  ]);
  return { shares, reddit };
}

// A raw group from the edge cache, or fetched and stored for `ttl`. A group
// that holds one day carries the date in its name: an export day its UTC
// date, the Query API's groups the project-local date, so a group from before
// midnight is not read as today's.
//
// Each fetched group is also kept as its last good copy. When a fetch fails,
// or Mixpanel answered 429 within BACKOFF_SECONDS (a marker for the whole
// project, since the limit is the project's), the last good copy is served
// with the time it was fetched, and a 429 sends no call at all until the
// marker expires: an open page polling every five minutes would otherwise
// spend every refresh on refusals. With `retry`, any failure also stands as
// the answer for that long, null if there is no copy, so a query that keeps
// failing costs one call a `retry`, not one a poll. The Query API and the
// export each have a marker of their own (`limit`), since Mixpanel lists
// their limits apart.
const BACKOFF_SECONDS = 600;
type Limit = 'query' | 'export';

interface Kept<T> { at: string; value: T }
type Group<T> = { value: T; hit: boolean; staleSince: string | null };

const cacheKey = (name: string) => new Request(`https://pulse-cache.invalid/${name}?v=${RAW_VERSION}`);
const stored = (body: unknown, ttl: number) => new Response(JSON.stringify(body), {
  headers: { 'content-type': JSON_TYPE, 'cache-control': `public, max-age=${ttl}` },
});

export class RateLimited extends Error {
  constructor(readonly until: string) { super(`Mixpanel's hourly query limit is used up; trying again after ${until}`); }
}

async function cachedGroup<T>(
  ctx: ExecutionContext, name: string, ttl: number, load: () => Promise<T>,
  { retry, limit = 'query' }: { retry?: number; limit?: Limit } = {},
): Promise<Group<T>> {
  const fresh = cacheKey(name);
  const keep = cacheKey(`last-${name}`);
  const backoff = cacheKey(`backoff-${limit}`);
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

// The oldest fetch time among the groups served as a last good copy, or null when every one is fresh.
const oldestStale = (groups: Group<unknown>[]) =>
  groups.map((g) => g.staleSince).filter((t): t is string => t !== null).sort()[0] ?? null;
const cacheState = (g: Group<unknown>) => (g.staleSince ? 'stale' : g.hit ? 'hit' : 'miss');

const failure = (e: unknown) => (e instanceof RateLimited
  ? json({ error: e.message, retryAfter: e.until }, 503)
  : json({ error: e instanceof Error ? e.message : String(e) }, 502));

// Browsers' events for each of `days`, a cached group a UTC day. The last day
// is today, which is still filling. The export has a pool of its own, so a
// three-second day never holds up the Query API's calls, and a pool of two,
// since the export refuses a fourth call in one second (found 2026-11-17, when
// eight days asked four at a time).
async function eventsByDay(ctx: ExecutionContext, env: Env, days: string[]) {
  const client: Client = { env, run: pool(EXPORT_AT_ONCE), limited: false };
  const today = days.at(-1);
  const groups = await Promise.all(days.map((date) => cachedGroup(
    ctx, `events-${date}`, date === today ? TODAY_SECONDS : FINISHED_DAY_SECONDS,
    () => fetchDay(client, date), { limit: 'export' },
  )));
  return {
    events: groups.flatMap((g) => g.value),
    staleSince: oldestStale(groups),
    cache: days.map((date, i) => `${date}=${cacheState(groups[i]!)}`).join(' '),
  };
}

type Route = (url: URL, env: Env, ctx: ExecutionContext) => Promise<Response>;

const stats: Route = async (url, env, ctx) => {
  const asked = url.searchParams.get('path');
  if (asked !== null && !isPathKey(asked)) return json({ error: `unknown path filter: ${asked}` }, 400);
  const pathKey: PathKey = asked ?? DEFAULT_PATH;
  const siteUrl = pathUrl(pathKey);

  const at = new Date();
  const now = localNow(env.MIXPANEL_TZ, at);
  const client: Client = { env, run: pool(4), limited: false };
  try {
    const [days, previews, measured] = await Promise.all([
      eventsByDay(ctx, env, exportDays(at, WEEK_HOURS)),
      // neither of these is the screen's failure, or what its stale note reports: each draws as no answer without a copy
      cachedGroup<Previews | null>(ctx, `previews-${now.date}`, SLOW_SECONDS, () => fetchPreviews(client, now.date), { retry: PREVIEWS_RETRY })
        .catch(() => null),
      pathKey === 'puttingupnumbers'
        ? cachedGroup<MeasureDays | null>(ctx, `measures-${now.date}`, MEASURES_SECONDS, () => fetchMeasures(client, now.date, siteUrl!), { retry: MEASURES_RETRY })
          .catch(() => null)
        : null,
    ]);
    const previewRows = previews?.value ? previewsOf(previews.value, now.date) : null;
    const measureDays = measured?.value ?? null;
    const landings = landingsFrom('reddit', days.events, env.PAGEVIEW_EVENT, at);
    const numbers = numbersOf(days.events, env.PAGEVIEW_EVENT, now, pathKey, {
      shares: previewRows?.shares ?? null,
      redditLinks: previewRows?.redditLinks ?? null,
      measures: measureDays && measures(measureDays, now.date),
      redditLandings: landings.filter((landing) => !siteUrl || landing.href.includes(siteUrl)),
    }, at);
    return json(
      { ...numbers, staleSince: days.staleSince },
      200, { 'x-pulse-cache': `${days.cache} previews=${previews ? cacheState(previews) : 'failed'}` },
    );
  } catch (e) {
    return failure(e);
  }
};

const visitors: Route = async (_url, env, ctx) => {
  const at = new Date();
  try {
    const days = await eventsByDay(ctx, env, exportDays(at));
    return json(
      { ...visitorsOf(days.events, env.PAGEVIEW_EVENT, env.MIXPANEL_TZ, at), staleSince: days.staleSince },
      200, { 'x-pulse-cache': days.cache },
    );
  } catch (e) {
    return failure(e);
  }
};

const ROUTES = new Map<string, Route>([['/stats', stats], ['/visitors', visitors]]);

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/pulse\/api/, '').replace(/\/$/, '') || '/';
    const configured = Boolean(env.MIXPANEL_SERVICE_ACCOUNT && env.PULSE_TOKEN);

    if (path === '/health') return json({ ok: true, configured });
    const route = ROUTES.get(path);
    if (!route) return json({ error: 'not found' }, 404);
    if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405);
    if (!configured) {
      return json({ error: 'worker not configured: set the PULSE_TOKEN and MIXPANEL_SERVICE_ACCOUNT secrets' }, 503);
    }
    const given = bearer(req) ?? url.searchParams.get('k');
    if (!given || !sameToken(given, env.PULSE_TOKEN!)) return json({ error: 'unauthorized' }, 401);
    return route(url, env, ctx);
  },
} satisfies ExportedHandler<Env>;
