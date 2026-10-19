import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from './index';

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
let store = new Map<string, Response>();

beforeEach(() => {
  calls = [];
  status = 200;
  store = new Map<string, Response>();
  vi.stubGlobal('caches', {
    default: {
      match: async (req: Request) => store.get(req.url)?.clone(),
      put: async (req: Request, res: Response) => { store.set(req.url, res); },
    },
  });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    calls.push(new URL(String(input)));
    if (status !== 200) return new Response('{"error": "Query rate limit exceeded"}', { status });
    return new Response(JSON.stringify({ data: { series: [], values: {} } }), { status: 200 });
  });
  // Node has no timingSafeEqual; the worker only ever passes it encoded strings
  const subtle = crypto.subtle as unknown as { timingSafeEqual?: (a: Uint8Array, b: Uint8Array) => boolean };
  subtle.timingSafeEqual ??= (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
});
afterEach(() => vi.unstubAllGlobals());

const stats = (q = '') => worker.fetch(
  new Request(`https://drewhoover.com/pulse/api/stats${q}`, { headers: { authorization: 'Bearer test-token' } }),
  env, ctx,
);

describe('the path filter', () => {
  it('defaults to Streak King and filters every pageview call to its path', async () => {
    const res = await stats();
    expect(res.status).toBe(200);
    expect((await res.json() as { path: string }).path).toBe('cfb-streak-king');
    const pageviews = calls.filter((u) => u.searchParams.get('event')?.includes('$mp_web_page_view'));
    expect(pageviews).toHaveLength(12);
    for (const u of pageviews) {
      expect(u.pathname).toBe('/api/query/segmentation');
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

  it('reads all of the site with no filter, totals from /events', async () => {
    const res = await stats('?path=all');
    expect((await res.json() as { path: string }).path).toBe('all');
    const pageviews = calls.filter((u) => u.searchParams.get('event') === '$mp_web_page_view');
    expect(pageviews.some((u) => u.searchParams.get('where')?.includes('$current_url'))).toBe(false);
    expect(calls.filter((u) => u.pathname === '/api/query/events')).toHaveLength(4);
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
