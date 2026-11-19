import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from './index';
import { MEASURES_JQL, type Measures } from './measures';
import { WEEK_HOURS } from './numbers';
import { realWhere, type Stats } from './shape';
import { exportDays, spanHours, type Visitors } from './visitors';

// The worker against a stand-in Mixpanel: every call is recorded, an export
// call answers its day's lines of `exported`, and a Query API call an empty
// series, so the test reads which calls a screen makes.
const env: Env = {
  MIXPANEL_SERVICE_ACCOUNT: 'user:secret',
  PULSE_TOKEN: 'test-token',
  MIXPANEL_PROJECT_ID: '1',
  MIXPANEL_TZ: 'America/New_York',
  MIXPANEL_API: 'https://mixpanel.invalid',
  MIXPANEL_EXPORT: 'https://data.mixpanel.invalid',
  PAGEVIEW_EVENT: '$mp_web_page_view',
  UNFURL_EVENT: 'share unfurl',
};
// Work the worker leaves running behind a response. A request here waits for
// it, so the calls a test counts are all in before it counts them.
const behind: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => { behind.push(p); }, passThroughOnException: () => {} } as unknown as ExecutionContext;
async function settled<T>(res: T): Promise<T> {
  while (behind.length > 0) await Promise.allSettled(behind.splice(0));
  return res;
}

let calls: URL[] = [];
let status = 200;
let jql: unknown = null; // what a measures call answers, or the stand-in's series
let exported = ''; // what an export call answers: a JSON object a line
let store = new Map<string, Response>();

beforeEach(() => {
  calls = [];
  status = 200;
  jql = null;
  exported = '';
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
    if (String(input).startsWith(env.MIXPANEL_EXPORT)) return new Response(exportedOn(calls.at(-1)!.searchParams.get('from_date')!), { status: 200 });
    return new Response(JSON.stringify({ data: { series: [], values: {} } }), { status: 200 });
  });
  // Node has no timingSafeEqual; the worker only ever passes it encoded strings
  const subtle = crypto.subtle as unknown as { timingSafeEqual?: (a: Uint8Array, b: Uint8Array) => boolean };
  subtle.timingSafeEqual ??= (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
});
afterEach(() => vi.unstubAllGlobals());

// The export answers a day with that UTC day's events, as Mixpanel does.
const exportedOn = (day: string) => exported.split('\n').filter((line) =>
  line && new Date((JSON.parse(line) as { properties: { time: number } }).properties.time).toISOString().startsWith(day)).join('\n');

let measuresCalls = 0;
const isMeasures = (init?: RequestInit) => init?.body instanceof URLSearchParams && init.body.get('script') === MEASURES_JQL;

const stats = async (q = '') => settled(await worker.fetch(
  new Request(`https://drewhoover.com/pulse/api/stats${q}`, { headers: { authorization: 'Bearer test-token' } }),
  env, ctx,
));

const exports = () => calls.filter((u) => u.pathname === '/api/2.0/export');
const queries = () => calls.filter((u) => u.pathname.startsWith('/api/query/'));
const weekDays = () => exportDays(new Date(), WEEK_HOURS).length;
const pageview = (device: string, hoursAgo: number, url: string, more: Record<string, unknown> = {}) => JSON.stringify({
  event: '$mp_web_page_view',
  properties: {
    time: Date.now() - hoursAgo * 3_600_000, distinct_id: `$device:${device}`, $device_id: device, $insert_id: `${device}${hoursAgo}`,
    $current_url: url, ...more,
  },
});

describe('the numbers screen', () => {
  it('asks the export for a week, one UTC day a call, real users only', async () => {
    const res = await stats('?path=cfb-streak-king');
    expect(res.status).toBe(200);
    expect(exports()).toHaveLength(weekDays());
    for (const u of exports()) {
      expect(u.searchParams.get('to_date')).toBe(u.searchParams.get('from_date'));
      expect(u.searchParams.get('where')).toBe(realWhere);
    }
  });

  it('asks the Query API only for the link previews, unfiltered by path, and the three numbers on Putting Up Numbers', async () => {
    await stats('?path=cfb-streak-king');
    expect(queries().map((u) => u.searchParams.get('event'))).toEqual(['share unfurl', 'share unfurl']);
    const [shares, reddit] = queries();
    expect(shares!.searchParams.has('where')).toBe(false);
    expect(reddit!.searchParams.get('where')).not.toContain('$current_url');
    expect(reddit!.searchParams.get('unit')).toBe('hour');
    await stats();
    expect(queries().map((u) => u.pathname)).toEqual(['/api/query/segmentation', '/api/query/segmentation', '/api/query/jql']);
  });

  it('counts the filter\'s pages from the export', async () => {
    exported = [
      pageview('a', 1, 'https://drewhoover.com/cfb-streak-king/'),
      pageview('b', 1, 'https://drewhoover.com/cfb-streak-king/games/'),
      pageview('c', 1, 'https://drewhoover.com/hostile-territory/'),
    ].join('\n');
    const body = await (await stats('?path=cfb-streak-king')).json() as Stats;
    expect(body.path).toBe('cfb-streak-king');
    expect(body.totals.week).toBe(2);
    expect(body.pages.map((p) => p.name).sort()).toEqual(['/', '/games/']);
    expect(body.shares).toEqual([]); // the stand-in's empty series
  });

  it('asks nothing more for another filter, since every filter reads the same days', async () => {
    await stats('?path=all');
    const sent = calls.length;
    await stats('?path=all');
    await stats('?path=hostile-territory');
    expect(calls.length).toBe(sent);
  });

  it('draws without the link previews when the Query API fails, and asks again only after the retry', async () => {
    const original = globalThis.fetch;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => (String(input).startsWith(env.MIXPANEL_API)
      ? (calls.push(new URL(String(input))), Promise.resolve(new Response('{"error":"boom"}', { status: 500 })))
      : original(input, init)));
    const body = await (await stats('?path=all')).json() as Stats;
    expect(body.shares).toBeNull();
    expect(body.reddit.links).toBeNull();
    const sent = queries().length;
    await stats('?path=all');
    expect(queries().length).toBe(sent);
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

  it('holds its answer through the days and the previews refreshing', async () => {
    jql = [{}];
    await stats();
    expire('events-');
    expire('previews-');
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
    expect(exports().length).toBeLessThan(weekDays()); // the days queued behind the first refusal never go out
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
    expect(res.headers.get('x-pulse-cache')).toMatch(/^(\S+=stale )+previews=stale$/);
    expect((await res.json() as { staleSince: string | null }).staleSince).toMatch(/^\d{4}-/);
    const sent = calls.length;
    expect((await stats()).status).toBe(200);
    expect(calls.length).toBe(sent); // inside the backoff, from the kept copy without asking
  });

  it('says nothing is stale on a fresh answer', async () => {
    const res = await stats();
    expect((await res.json() as { staleSince: string | null }).staleSince).toBeNull();
    expect(res.headers.get('x-pulse-cache')).not.toContain('stale');
  });
});

describe('the visitors screen', () => {
  const visitors = async (token = 'test-token') => settled(await worker.fetch(
    new Request('https://drewhoover.com/pulse/api/visitors', { headers: { authorization: `Bearer ${token}` } }),
    env, ctx,
  ));
  const utcDay = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
  const view = (device: string, minutesAgo: number) => JSON.stringify({
    event: '$mp_web_page_view',
    properties: {
      time: Date.now() - minutesAgo * 60_000, distinct_id: `$device:${device}`, $device_id: device, $insert_id: `${device}${minutesAgo}`,
      $current_url: 'https://drewhoover.com/hostile-territory/', site: 'hostile-territory',
    },
  });

  it('asks the export for one UTC day a call, real users only, and nothing of the Query API', async () => {
    const res = await visitors();
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(exports().length);
    const days = exports().map((u) => u.searchParams.get('from_date'));
    expect(days).toContain(utcDay(0));
    expect(days).toContain(utcDay(2));
    for (const u of exports()) {
      expect(u.host).toBe('data.mixpanel.invalid');
      expect(u.searchParams.get('to_date')).toBe(u.searchParams.get('from_date'));
      expect(u.searchParams.get('where')).toBe(realWhere);
      expect(u.searchParams.get('time_in_ms')).toBe('true');
    }
  });

  it('answers the visitors since midnight, shaped', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-17T17:00:00Z') }); // noon in New York
    exported = [view('a', 30), view('a', 20), view('b', 5), view('c', 13 * 60)].join('\n'); // c left at 11 pm
    const body = await (await visitors()).json() as Visitors;
    vi.useRealTimers();
    expect(body.visitors.map((v) => [v.id, v.visits[0]!.views])).toEqual([['b', 1], ['a', 2]]);
    expect(body.arrivals.map((a) => [a.source, a.site, a.visitors])).toEqual([['direct', 'hostile territory', 2]]);
    expect(body.staleSince).toBeNull();
  });

  it('asks again only for today once the days are cached', async () => {
    await visitors();
    const first = exports().length;
    await visitors();
    expect(exports().length).toBe(first);
    for (const k of [...store.keys()]) if (k.includes(`/events-${utcDay(0)}`)) store.delete(k); // today's five minutes pass
    await visitors();
    expect(exports().length).toBe(first + 1);
    expect(exports().at(-1)!.searchParams.get('from_date')).toBe(utcDay(0));
  });

  it('keeps its own 429 marker, so a refused export leaves the Query API asking', async () => {
    status = 429;
    expect((await visitors()).status).toBe(503);
    const sent = calls.length;
    expect((await visitors()).status).toBe(503);
    expect(calls.length).toBe(sent); // inside the export's backoff
    status = 200;
    expect((await stats()).status).toBe(503);
    expect(exports()).toHaveLength(sent);
    expect(queries().length).toBeGreaterThan(0);
  });

  it('asks for two weeks and two days for ?span=week, and refuses a span it doesn\'t know', async () => {
    const res = await settled(await worker.fetch(
      new Request('https://drewhoover.com/pulse/api/visitors?span=week', { headers: { authorization: 'Bearer test-token' } }), env, ctx,
    ));
    expect((await res.json() as Visitors).span).toBe('week');
    expect(exports()).toHaveLength(exportDays(new Date(), spanHours('week')).length);
    const bad = await worker.fetch(
      new Request('https://drewhoover.com/pulse/api/visitors?span=month', { headers: { authorization: 'Bearer test-token' } }), env, ctx,
    );
    expect(bad.status).toBe(400);
  });

  it('wants the token', async () => {
    expect((await visitors('wrong')).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe('the pages Reddit\'s visitors landed on', () => {
  type Landed = { redditLandings: { site: string; page: string; visitors: number }[] };
  const fromReddit = { $referrer: 'https://www.reddit.com/' };
  const week = () => [
    pageview('a', 2, 'https://drewhoover.com/hostile-territory/', { ...fromReddit, site: 'hostile-territory' }),
    pageview('b', 80, 'https://drewhoover.com/hostile-territory/', { ...fromReddit, site: 'hostile-territory' }),
    pageview('c', 50, 'https://drewhoover.com/cfb-streak-king/?c=home', { ...fromReddit, site: 'cfb-streak-king' }),
  ].join('\n');

  it('come with the numbers, a week of them, cut to the filter', async () => {
    exported = week();
    const all = await (await stats('?path=all')).json() as Landed;
    expect(all.redditLandings.map((l) => [l.site, l.page, l.visitors])).toEqual([['hostile territory', '/', 2], ['streak king', '/', 1]]);
    const streakKing = await (await stats('?path=cfb-streak-king')).json() as Landed;
    expect(streakKing.redditLandings.map((l) => l.site)).toEqual(['streak king']);
    expect(exports()).toHaveLength(weekDays()); // a call a UTC day, once
  });

  it('ask the export two days at a time, since it refuses a fourth call in one second', async () => {
    let inFlight = 0;
    let most = 0;
    const original = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).startsWith(env.MIXPANEL_EXPORT)) return original(input, init);
      most = Math.max(most, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return original(input, init);
    });
    await stats('?path=all');
    expect(exports()).toHaveLength(weekDays());
    expect(most).toBe(2);
  });
});
