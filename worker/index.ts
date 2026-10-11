// The pulse API: one JSON endpoint in front of Mixpanel's Query API, so the
// service account never leaves Cloudflare and the static page on GitHub Pages
// holds nothing secret. Routed at drewhoover.com/pulse/api/*, same-origin with
// the page, so no CORS.
//
//   GET /pulse/api/stats   bearer token (or ?k=), the shaped stats JSON
//   GET /pulse/api/health  no auth, whether the secrets are set
//
// Mixpanel allows 60 Query API calls an hour per project. A full refresh is
// ten calls, so the raw answers sit in the edge cache in two groups: the
// hourly series (2 calls) for FAST_SECONDS and everything else (8 calls) for
// SLOW_SECONDS. Polled without pause that is 24 + 24 calls an hour, and every
// client, page or widget, reads the same copies.

import { INTERNAL, shape, type Fast, type Raw, type Series, type Slow } from './shape';
import { addDays, localNow, type LocalNow } from './time';

export interface Env {
  MIXPANEL_SERVICE_ACCOUNT?: string; // secret: "<username>:<secret>" of a Mixpanel service account
  PULSE_TOKEN?: string;              // secret: the bearer token the page and the widget send
  MIXPANEL_PROJECT_ID: string;
  MIXPANEL_TZ: string;               // the project's timezone, as set in Mixpanel
  MIXPANEL_API: string;              // https://mixpanel.com (https://eu.mixpanel.com for EU residency)
  PAGEVIEW_EVENT: string;
}

const FAST_SECONDS = 300;
const SLOW_SECONDS = 1200;
const RAW_VERSION = 2; // bump with any change to what is fetched, so a stale cached group is skipped

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

interface Client { env: Env; run: Run }

async function query({ env, run }: Client, path: string, params: Record<string, string>): Promise<Series> {
  const url = new URL(`${env.MIXPANEL_API}/api/query/${path}`);
  url.searchParams.set('project_id', env.MIXPANEL_PROJECT_ID);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await run(() => fetch(url, {
    headers: { authorization: `Basic ${btoa(env.MIXPANEL_SERVICE_ACCOUNT!)}`, accept: 'application/json' },
  }));
  if (!res.ok) throw new Error(`mixpanel ${path} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function fetchFast(c: Client, today: string): Promise<Fast> {
  const event = JSON.stringify([c.env.PAGEVIEW_EVENT]);
  const from_date = addDays(today, -1);
  const [hours, hoursUnique] = await Promise.all([
    query(c, 'events', { event, type: 'general', unit: 'hour', from_date, to_date: today }),
    query(c, 'events', { event, type: 'unique', unit: 'hour', from_date, to_date: today }),
  ]);
  return { hours, hoursUnique };
}

async function fetchSlow(c: Client, today: string): Promise<Slow> {
  const event = c.env.PAGEVIEW_EVENT;
  const weekStart = addDays(today, -6);
  const events = (type: string) =>
    query(c, 'events', { event: JSON.stringify([event]), type, unit: 'day', from_date: weekStart, to_date: today });
  const segmentation = (on: string, type: string, from_date: string, where?: string) =>
    query(c, 'segmentation', {
      event, type, on, from_date, to_date: today, unit: 'day', limit: '60', ...(where ? { where } : {}),
    });
  const outside = `defined(properties["$referrer"]) and properties["$referring_domain"] != "${INTERNAL}"`;
  const [days, daysUnique, domains, domainsUniqueToday, urls, urlsUniqueToday, pages, pagesUniqueToday] =
    await Promise.all([
      events('general'),
      events('unique'),
      segmentation('properties["$referring_domain"]', 'general', weekStart),
      segmentation('properties["$referring_domain"]', 'unique', today),
      segmentation('properties["$referrer"]', 'general', weekStart, outside),
      segmentation('properties["$referrer"]', 'unique', today, outside),
      segmentation('properties["current_url_path"]', 'general', weekStart),
      segmentation('properties["current_url_path"]', 'unique', today),
    ]);
  return { days, daysUnique, domains, domainsUniqueToday, urls, urlsUniqueToday, pages, pagesUniqueToday };
}

// A raw group from the edge cache, or fetched and stored for `ttl`. The key
// carries the project-local date so a group from before midnight is not read
// as today's.
async function cachedGroup<T>(
  ctx: ExecutionContext, name: string, now: LocalNow, ttl: number, load: () => Promise<T>,
): Promise<{ value: T; hit: boolean }> {
  const key = new Request(`https://pulse-cache.invalid/${name}?v=${RAW_VERSION}&d=${now.date}`);
  const hit = await caches.default.match(key);
  if (hit) return { value: await hit.json<T>(), hit: true };
  const value = await load();
  ctx.waitUntil(caches.default.put(key, new Response(JSON.stringify(value), {
    headers: { 'content-type': JSON_TYPE, 'cache-control': `public, max-age=${ttl}` },
  })));
  return { value, hit: false };
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

    const now = localNow(env.MIXPANEL_TZ);
    const client: Client = { env, run: pool(4) };
    let raw: Raw;
    let cache: string;
    try {
      const [fast, slow] = await Promise.all([
        cachedGroup(ctx, 'fast', now, FAST_SECONDS, () => fetchFast(client, now.date)),
        cachedGroup(ctx, 'slow', now, SLOW_SECONDS, () => fetchSlow(client, now.date)),
      ]);
      raw = { event: env.PAGEVIEW_EVENT, ...fast.value, ...slow.value };
      cache = `fast=${fast.hit ? 'hit' : 'miss'} slow=${slow.hit ? 'hit' : 'miss'}`;
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 502);
    }
    return json(shape(raw, now), 200, { 'x-pulse-cache': cache });
  },
} satisfies ExportedHandler<Env>;
