import { describe, expect, it } from 'vitest';
import { ACTS, MEASURES_JQL, measures, quantile, type MeasureDay, type MeasureDays } from './measures';
import { BOT_AGENT, BOT_ID, DREW_CITY, DREW_DEVICES } from './shape';
import { measuresList } from '../src/render';

// The JQL against a stand-in for Mixpanel's runtime: a visitor's events arrive
// in time order and in batches, and the reduce runs in two parts, so the query
// is read the way Mixpanel runs it.
const VIEW = '$mp_web_page_view';
const ORIGIN = 'https://puttingupnumbers.com';
const T0 = Date.UTC(2026, 10, 3, 18); // 2026-11-03, 1pm in New York

interface Ev { name: string; time: number; distinct_id: string; properties: Record<string, unknown> }
type Reducer = (accs: unknown[], items: unknown[]) => unknown;

function runtime(events: Ev[]) {
  return () => {
    let rows = events;
    const chain = {
      filter(keep: (e: Ev) => boolean) { rows = rows.filter(keep); return chain; },
      groupByUser(reduce: (seen: unknown, batch: Ev[]) => unknown) {
        const ids = [...new Set(rows.map((e) => e.distinct_id))];
        const users = ids.map((id) => {
          const mine = rows.filter((e) => e.distinct_id === id).sort((a, b) => a.time - b.time);
          let seen: unknown;
          for (let i = 0; i < mine.length; i += 2) seen = reduce(seen, mine.slice(i, i + 2));
          return { key: [id], value: seen };
        });
        return {
          reduce(f: Reducer) {
            const half = Math.ceil(users.length / 2);
            return [f([f([], users.slice(0, half)), f([], users.slice(half))], [])];
          },
        };
      },
    };
    return chain;
  };
}

function run(events: Ev[]): MeasureDays {
  const params = {
    from: '2026-09-09', to: '2026-11-03', url: 'puttingupnumbers.com/', event: VIEW, acts: ACTS,
    offset: -5 * 3600_000, sessionMs: 30 * 60_000, resolveMs: 2000,
    drewDevices: DREW_DEVICES, drewCity: DREW_CITY, botId: BOT_ID, botAgent: BOT_AGENT,
  };
  const main = new Function('Events', 'params', `${MEASURES_JQL}\nreturn main();`);
  return (main(runtime(events), params) as MeasureDays[])[0]!;
}

// [seconds after T0, event, path], one visitor's
const visitor = (id: string, acts: [number, string, string, Record<string, unknown>?][]): Ev[] =>
  acts.map(([s, name, path, props]) => ({
    name: name === 'view' ? VIEW : name, time: T0 + s * 1000, distinct_id: id,
    properties: { $current_url: `${ORIGIN}${path}`, ...props },
  }));

const day = (events: Ev[]): MeasureDay => run(events)['2026-11-03']!;

describe('Hunting', () => {
  it('counts a landing whose first act was a sentence change, a search or a split', () => {
    const d = day([
      ...visitor('a', [[0, 'view', '/nhl/most-goals-in-a-career/'], [9, 'query', '/nhl/most-goals-in-a-career/'], [9, 'view', '/nhl/build/?stat=a']]),
      ...visitor('b', [[0, 'view', '/nba/'], [4, 'find', '/nba/', { page: '/nba/players/x/' }], [4, 'view', '/nba/players/x/']]),
      ...visitor('c', [[0, 'view', '/cfb/teams/alabama/splits/'], [4, 'split', '/cfb/teams/alabama/splits/']]),
    ]);
    expect(d.landings).toBe(3);
    expect(d.hunted).toBe(3);
    expect(d.acted).toBe(3);
  });

  it('leaves out a landing whose first act was a link or a row', () => {
    const d = day([
      ...visitor('a', [[0, 'view', '/nba/'], [5, 'view', '/nba/teams/lakers/'], [20, 'query', '/nba/teams/lakers/']]),
      ...visitor('b', [[0, 'view', '/nba/all-time/'], [5, 'open', '/nba/all-time/'], [5, 'view', '/nba/all-time/?t=1'], [9, 'query', '/nba/all-time/?t=1']]),
    ]);
    expect(d.hunted).toBe(0);
    expect(d.acted).toBe(2);
  });

  it('keeps a landing with no act in the landings, and a window pick or a reload is no act', () => {
    const d = day([
      ...visitor('a', [[0, 'view', '/nfl/']]),
      ...visitor('b', [[0, 'view', '/nfl/'], [6, 'view', '/nfl/?w=week'], [8, 'view', '/nfl/']]),
    ]);
    expect(d.landings).toBe(2);
    expect(d.acted).toBe(0);
  });

  it('reads a sentence change in the second it shares with its pageview as coming first', () => {
    const d = day(visitor('a', [[0, 'view', '/nba/'], [7, 'view', '/nba/build/?n=5'], [7, 'query', '/nba/']]));
    expect(d.hunted).toBe(1);
  });

  it('takes a builder address the site resolved to a named page as that page', () => {
    for (const gap of [0, 1]) {
      const d = day(visitor('a', [[0, 'view', '/nfl/build/?pos=RB'], [gap, 'view', '/nfl/most-rushing-tds/']]));
      expect(d).toMatchObject({ landings: 1, acted: 0, hunted: 0, named: 1 });
    }
  });

  it('counts a link off the builder after the page had time to resolve', () => {
    const d = day(visitor('a', [[0, 'view', '/nfl/build/?pos=RB'], [12, 'view', '/nfl/players/x/']]));
    expect(d).toMatchObject({ acted: 1, hunted: 0, named: 1 });
  });
});

describe('a session', () => {
  it('ends at a 30 minute gap', () => {
    const d = day(visitor('a', [[0, 'view', '/nba/'], [29 * 60, 'view', '/nba/teams/lakers/'], [59 * 60, 'view', '/nba/']]));
    expect(d.landings).toBe(2);
    expect(d.named).toBe(3);
  });

  it('belongs to the New York day it landed on', () => {
    const late = 10 * 3600; // 11pm on the 3rd in New York is 04:00 UTC on the 4th
    const days = run(visitor('a', [[late, 'view', '/nba/'], [late + 3600 * 3, 'view', '/nba/']]));
    expect(Object.keys(days).sort()).toEqual(['2026-11-03', '2026-11-04']);
  });

  it('sits out the real-user test', () => {
    const d = run(visitor('bot:1', [[0, 'view', '/nba/']]));
    expect(d).toEqual({});
  });

  it('reads only this site', () => {
    const other = visitor('a', [[0, 'view', '/x/']]).map((e) => ({ ...e, properties: { $current_url: 'https://drewhoover.com/cfb-streak-king/' } }));
    expect(run(other)).toEqual({});
  });
});

describe('Depth', () => {
  it('counts each named page once and never the builder', () => {
    const d = day(visitor('a', [
      [0, 'view', '/nhl/'], [5, 'view', '/nhl/teams/bruins/'], [9, 'view', '/nhl/'],
      [12, 'query', '/nhl/'], [12, 'view', '/nhl/build/?n=5'], [40, 'view', '/nhl/build/?n=6'],
      [50, 'open', '/nhl/build/?n=6'], [50, 'view', '/nhl/build/?n=6&t=1'],
    ]));
    expect(d.named).toBe(2);
  });

  it('adds a session that landed on a team page to the team row too', () => {
    const d = day([
      ...visitor('a', [[0, 'view', '/nba/teams/lakers/'], [5, 'view', '/nba/players/x/'], [9, 'query', '/nba/players/x/']]),
      ...visitor('b', [[0, 'view', '/nba/teams/lakers/guards/']]),
      ...visitor('c', [[0, 'view', '/nba/teams/lakers/splits/']]),
    ]);
    expect(d.landings).toBe(3);
    expect(d.team).toEqual({ landings: 1, hunted: 0, acted: 1, named: 2 });
  });
});

describe('Instant', () => {
  it('lists every answer on its day, and an answer is no act', () => {
    const d = day(visitor('a', [
      [0, 'view', '/nba/'], [8, 'answer', '/nba/', { ms: 140 }], [9, 'answer', '/nba/', { ms: 90 }], [9, 'answer', '/nba/'],
    ]));
    expect(d.ms.sort()).toEqual([140, 90].sort());
    expect(d.acted).toBe(0);
  });

  it('takes the middle and the 90th percentile', () => {
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([100], 0.9)).toBe(100);
    expect(quantile([100, 200], 0.5)).toBe(150);
    expect(quantile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110], 0.9)).toBe(100);
  });
});

describe('the windows', () => {
  const one = (landings: number, ms: number[] = []): MeasureDay => ({
    landings, hunted: 1, acted: 2, named: landings * 2, team: { landings: 1, hunted: 0, acted: 1, named: 1 }, ms,
  });

  it('are the last 7 days, the last 28 and the 28 before, today among the first two', () => {
    const m = measures({
      '2026-11-03': one(1, [100]), '2026-10-28': one(2), '2026-10-27': one(4, [300]), '2026-10-07': one(8),
      '2026-10-06': one(16, [500]), '2026-09-09': one(32), '2026-09-08': one(64),
    }, '2026-11-03');
    expect(m.week.landings).toBe(3);
    expect(m.month.landings).toBe(15);
    expect(m.before.landings).toBe(48);
    expect(m.month.team.landings).toBe(4);
    expect(m.month).toMatchObject({ answers: 2, median: 200 });
    expect(m.before).toMatchObject({ answers: 1, median: 500, p90: 500 });
  });

  it('draw a dash for a window with nothing in it', () => {
    const html = measuresList(measures({ '2026-11-03': one(4) }, '2026-11-03'));
    expect(html).toContain('25.0%');
    expect(html).toContain('2.00');
    expect(html).toContain('–');
    expect(html).toContain('no answers yet');
    expect(measuresList(measures({ '2026-11-03': one(4, [100, 300]) }, '2026-11-03'))).toContain('the median of 2 answers, 90th percentile 280ms');
  });
});
