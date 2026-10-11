// The pulse API: one JSON endpoint in front of Mixpanel's Query API, so the
// service account never leaves Cloudflare and the static page on GitHub Pages
// holds nothing secret. Routed at drewhoover.com/pulse/api/*, same-origin with
// the page, so no CORS.
//
//   GET /pulse/api/stats   bearer token (or ?k=), the shaped stats JSON
//   GET /pulse/api/health  no auth, whether the secrets are set
//
// Mixpanel allows 60 Query API calls an hour per project and a refresh costs
// four, so the shaped answer sits in the edge cache for CACHE_SECONDS and
// every client, page or widget, reads the same copy.

import { shape, type Raw, type Series } from './shape';
import { addDays, localNow } from './time';

export interface Env {
  MIXPANEL_SERVICE_ACCOUNT?: string; // secret: "<username>:<secret>" of a Mixpanel service account
  PULSE_TOKEN?: string;              // secret: the bearer token the page and the widget send
  MIXPANEL_PROJECT_ID: string;
  MIXPANEL_TZ: string;               // the project's timezone, as set in Mixpanel
  MIXPANEL_API: string;              // https://mixpanel.com (https://eu.mixpanel.com for EU residency)
  PAGEVIEW_EVENT: string;
}

const CACHE_SECONDS = 300;
const STATS_VERSION = 1; // bump with any change to the shape, so a stale cached copy is skipped

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
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

async function query(env: Env, path: string, params: Record<string, string>): Promise<Series> {
  const url = new URL(`${env.MIXPANEL_API}/api/query/${path}`);
  url.searchParams.set('project_id', env.MIXPANEL_PROJECT_ID);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { authorization: `Basic ${btoa(env.MIXPANEL_SERVICE_ACCOUNT!)}`, accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`mixpanel ${path} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function fetchRaw(env: Env, today: string): Promise<Raw> {
  const event = env.PAGEVIEW_EVENT;
  const yesterday = addDays(today, -1);
  const weekStart = addDays(today, -6);
  const events = (unit: string, from_date: string) =>
    query(env, 'events', { event: JSON.stringify([event]), type: 'general', unit, from_date, to_date: today });
  const segmentation = (on: string) =>
    query(env, 'segmentation', { event, from_date: weekStart, to_date: today, unit: 'day', on, limit: '50' });
  const [hours, days, referrers, pages] = await Promise.all([
    events('hour', yesterday),
    events('day', weekStart),
    segmentation('properties["$referring_domain"]'),
    segmentation('properties["current_url_path"]'),
  ]);
  return { event, hours, days, referrers, pages };
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

    const cache = caches.default;
    const key = new Request(`https://pulse-cache.invalid/stats?v=${STATS_VERSION}`);
    const hit = await cache.match(key);
    if (hit) {
      const headers = new Headers(hit.headers);
      headers.set('cache-control', 'no-store');
      headers.set('x-pulse-cache', 'hit');
      return new Response(hit.body, { status: hit.status, headers });
    }

    const now = localNow(env.MIXPANEL_TZ);
    let raw: Raw;
    try {
      raw = await fetchRaw(env, now.date);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 502);
    }
    const body = JSON.stringify(shape(raw, now));
    ctx.waitUntil(cache.put(key, new Response(body, {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${CACHE_SECONDS}` },
    })));
    return new Response(body, {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-pulse-cache': 'miss' },
    });
  },
} satisfies ExportedHandler<Env>;
