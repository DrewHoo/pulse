import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from './index';
import { MEASURES_JQL, type Measures } from './measures';
import { realWhere } from './shape';

// The worker against a stand-in Mixpanel: every call is recorded and answered
// with an empty series, so the test reads which calls a filter makes.
const env: Env = {
  MIXPANEL_SERVICE_ACCOUNT: 'user:secret',
  PULSE_TOKEN: 'test-token',
  MIXPANEL_PROJECT_ID: '1',
  MIXPANEL_TZ: 'America/New_York',
  MIXPANEL_API: 'https://mixpanel.invalid',
  PAGEVIEW_EVENT: '$mp_web_page_view',
  UNFURL_EVENT: 'share unfurl',
};
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

let calls: URL[] = [];
let status = 200;
let jql: unknown = null; // what a measures call answers, or the stand-in's series
let store = new Map<string, Response>();

beforeEach(() => {
  calls = [];
  status = 200;
  jql = null;
  store = new Map<string, Response>();
  vi.stubGlobal('caches', {
    default: {
      match: async (req: Request) => store.get(req.url)?.clone(),
      put: async (req: Request, res: Response) => { store.set(req.url, res); },
    },
  });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(new URL(String(input)));
    if (isMeasures(init)) measuresCalls++;
    if (isMeasures(init) && jql !== null) return new Response(JSON.stringify(jql), { status: 200 });
    if (status !== 200) return new Response('{"error": "Query rate limit exceeded"}', { status });
    return new Response(JSON.stringify({ data: { series: [], values: {} } }), { status: 200 });
  });
  // Node has no timingSafeEqual; the worker only ever passes it encoded strings
  const subtle = crypto.subtle as unknown as { timingSafeEqual?: (a: Uint8Array, b: Uint8Array) => boolean };
  subtle.timingSafeEqual ??= (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
});
afterEach(() => vi.unstubAllGlobals());

let measuresCalls = 0;
const isMeasures = (init?: RequestInit) => init?.body instanceof URLSearchParams && init.body.get('script') === MEASURES_JQL;

const stats = (q = '') => worker.fetch(
  new Request(`https://drewhoover.com/pulse/api/stats${q}`, { headers: { authorization: 'Bearer test-token' } }),
  env, ctx,
);

describe('the path filter', () => {
  it('defaults to Putting Up Numbers, every pageview call its pages and real users, with its sports', async () => {
    const res = await stats();
    expect(res.status).toBe(200);
    expect((await res.json() as { path: string }).path).toBe('puttingupnumbers');
    const pageviews = calls.filter((u) => u.searchParams.get('event')?.includes('$mp_web_page_view'));
    expect(pageviews).toHaveLength(14);
    for (const u of pageviews) {
      expect(u.pathname).toBe('/api/query/segmentation');
      expect(u.searchParams.get('where')).toContain('"puttingupnumbers.com/" in properties["$current_url"]');
      expect(u.searchParams.get('where')).toContain(realWhere);
    }
    expect(pageviews.filter((u) => u.searchParams.get('on') === 'properties["sport"]')).toHaveLength(2);
  });

  it('filters Streak King to its path, without the sports', async () => {
    await stats('?path=cfb-streak-king');
    const pageviews = calls.filter((u) => u.searchParams.get('event')?.includes('$mp_web_page_view'));
    expect(pageviews).toHaveLength(12);
    for (const u of pageviews) {
      expect(u.searchParams.get('where')).toContain('"drewhoover.com/cfb-streak-king/" in properties["$current_url"]');
    }
  });

  it('leaves the link previews unfiltered by path', async () => {
    await stats('?path=cfb-streak-king');
    const unfurls = calls.filter((u) => u.searchParams.get('event') === 'share unfurl');
    expect(unfurls).toHaveLength(2);
    const [shares, reddit] = unfurls;
    expect(shares!.searchParams.has('where')).toBe(false);
    expect(reddit!.searchParams.get('where')).not.toContain('$current_url');
    expect(reddit!.searchParams.get('unit')).toBe('hour');
  });

  it('reads all of the site with no path filter, still real users only', async () => {
    const res = await stats('?path=all');
    expect((await res.json() as { path: string }).path).toBe('all');
    const pageviews = calls.filter((u) => u.searchParams.get('event') === '$mp_web_page_view');
    expect(pageviews).toHaveLength(12);
    for (const u of pageviews) {
      expect(u.searchParams.get('where')).not.toContain('" in properties["$current_url"]');
      expect(u.searchParams.get('where')).toContain(realWhere);
    }
    expect(calls.filter((u) => u.pathname === '/api/query/events')).toHaveLength(0);
  });

  it('caches each filter apart', async () => {
    await stats('?path=all');
    const first = calls.length;
    await stats('?path=all');
    expect(calls.length).toBe(first);
    await stats('?path=cfb-streak-king');
    expect(calls.length).toBe(first * 2);
  });

  it('asks JQL who came back, once a refresh, and draws without it when it fails', async () => {
    const res = await stats('?path=blog');
    expect(calls.filter((u) => u.pathname === '/api/query/jql')).toHaveLength(1);
    expect((await res.json() as { returning: unknown }).returning).toBeNull(); // the stand-in answers a series, not a list
  });

  it('refuses a filter that is not on the list', async () => {
    const res = await stats('?path=/etc/');
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe('the three numbers', () => {
  const expire = (name: string) => { for (const k of [...store.keys()]) if (k.includes(`/${name}`)) store.delete(k); };
  const read = async (res: Response) => (await res.json() as { measures?: Measures | null }).measures;
  const day = { landings: 4, hunted: 1, acted: 2, named: 5, team: { landings: 0, hunted: 0, acted: 0, named: 0 }, ms: [120, 300] };

  beforeEach(() => { measuresCalls = 0; });

  it('asks once for Putting Up Numbers and sums the days', async () => {
    const date = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    jql = [{ [date]: day }];
    const m = await read(await stats());
    expect(measuresCalls).toBe(1);
    expect(m?.week.landings).toBe(4);
    expect(m?.week.median).toBe(210);
  });

  it('asks nothing for any other filter', async () => {
    const m = await read(await stats('?path=cfb-streak-king'));
    expect(measuresCalls).toBe(0);
    expect(m).toBeNull();
  });

  it('holds its answer through the slow group refreshing', async () => {
    jql = [{}];
    await stats();
    expire('slow-');
    expire('fast-');
    await stats();
    expect(measuresCalls).toBe(1);
  });

  it('draws the screen without them, and a failure asks again only after the retry', async () => {
    const res = await stats(); // the stand-in answers a series, not a list
    expect(res.status).toBe(200);
    expect(await read(res)).toBeNull();
    expect(measuresCalls).toBe(1);
    await stats();
    expect(measuresCalls).toBe(1);
  });

  it('keeps the last good copy over a failure, without calling the screen stale', async () => {
    jql = [{}];
    await stats();
    expire('measures');
    jql = null;
    const res = await stats();
    const body = await res.json() as { measures: Measures | null; staleSince: string | null };
    expect(measuresCalls).toBe(2);
    expect(body.measures?.month.landings).toBe(0);
    expect(body.staleSince).toBeNull();
  });
});

describe('a refused refresh', () => {
  const expire = () => { for (const k of [...store.keys()]) if (!/\/(last-|backoff)/.test(k)) store.delete(k); };

  it('stops asking at the first 429, and asks nothing until the backoff ends', async () => {
    status = 429;
    const res = await stats();
    expect(res.status).toBe(503);
    expect((await res.json() as { retryAfter?: string }).retryAfter).toBeTruthy();
    expect(calls.length).toBeLessThan(15); // the calls queued behind the first refusal never go out
    const sent = calls.length;
    expect((await stats()).status).toBe(503);
    expect(calls.length).toBe(sent);
  });

  it('serves the last good copy, saying when it was fetched', async () => {
    expect((await stats()).status).toBe(200);
    expire(); // the fresh copies age out
    status = 429;
    const res = await stats();
    expect(res.status).toBe(200);
    expect(res.headers.get('x-pulse-cache')).toBe('fast=stale slow=stale');
    expect((await res.json() as { staleSince: string | null }).staleSince).toMatch(/^\d{4}-/);
    const sent = calls.length;
    expect((await stats()).status).toBe(200);
    expect(calls.length).toBe(sent); // inside the backoff, from the kept copy without asking
  });

  it('says nothing is stale on a fresh answer', async () => {
    const res = await stats();
    expect((await res.json() as { staleSince: string | null }).staleSince).toBeNull();
    expect(res.headers.get('x-pulse-cache')).toBe('fast=miss slow=miss');
  });
});
