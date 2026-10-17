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

beforeEach(() => {
  calls = [];
  const store = new Map<string, Response>();
  vi.stubGlobal('caches', {
    default: {
      match: async (req: Request) => store.get(req.url)?.clone(),
      put: async (req: Request, res: Response) => { store.set(req.url, res); },
    },
  });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    calls.push(new URL(String(input)));
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
    expect(pageviews).toHaveLength(10);
    for (const u of pageviews) {
      expect(u.pathname).toBe('/api/query/segmentation');
      expect(u.searchParams.get('where')).toContain('"/cfb-streak-king/" in properties["current_url_path"]');
    }
  });

  it('leaves the link previews unfiltered', async () => {
    await stats('?path=cfb-streak-king');
    const shares = calls.filter((u) => u.searchParams.get('event') === 'share unfurl');
    expect(shares).toHaveLength(1);
    expect(shares[0]!.searchParams.has('where')).toBe(false);
  });

  it('reads all of the site with no filter, totals from /events', async () => {
    const res = await stats('?path=all');
    expect((await res.json() as { path: string }).path).toBe('all');
    expect(calls.some((u) => u.searchParams.has('where') && !u.searchParams.get('where')!.startsWith('defined('))).toBe(false);
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

  it('refuses a filter that is not on the list', async () => {
    const res = await stats('?path=/etc/');
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
