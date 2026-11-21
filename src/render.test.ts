import { describe, expect, it } from 'vitest';
import { numbersOf } from '../worker/numbers';
import type { SiteEvent } from '../worker/visitors';
import { render } from './render';
import type { Stats } from './stats';

const SK = 'https://drewhoover.com/cfb-streak-king/';
const at = (local: string) => Date.parse(`${local.replace(' ', 'T')}:00-04:00`);
const event = (name: string, local: string, own: SiteEvent['own'] = {}): SiteEvent => ({ name, at: at(local), device: 'a', url: SK, own });
const stats = numbersOf(
  [event('$mp_web_page_view', '2026-10-11 09:00'), event('leave', '2026-10-11 09:02', { load: 'l', seconds: 95, scroll: 40, taps: 1 })],
  '$mp_web_page_view', { date: '2026-10-11', hour: 11, minute: 38, tz: 'America/New_York' }, 'cfb-streak-king',
  { shares: null, redditLinks: null, measures: null, redditLandings: [] }, new Date('2026-10-11T15:38:00Z'),
);

describe('the numbers screen\'s days', () => {
  it('puts minutes in view, the median visit and pages a visit under each day', () => {
    const html = render(stats);
    expect(html).toContain('class="days timed"');
    expect(html).toContain('<em title="the median visit">1m 35s</em>');
    expect(html).toContain('<em title="pages a visit">1.0</em>');
  });

  it('draws the days as they were from a worker older than the page, whose days have no time', () => {
    const older = { ...stats, days: stats.days.map(({ date, n, visitors }) => ({ date, n, visitors })) } as unknown as Stats;
    const html = render(older);
    expect(html).toContain('class="days"');
    expect(html).not.toContain('the median visit');
    expect(html).not.toContain('NaN');
  });
});
