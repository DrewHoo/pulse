import { describe, expect, it } from 'vitest';
import { addressOf, deviceName, placeName, sourceName } from './names';

describe('a site and its page', () => {
  const named = (href: string, site?: string, sport?: string) => {
    const { site: label, page, query } = addressOf(href, site, sport);
    return [label, page, query];
  };

  it('labels the three sites Drew named and drops each one\'s own path', () => {
    expect(named('https://drewhoover.com/cfb-streak-king/longest-home-win-streaks/', 'cfb-streak-king'))
      .toEqual(['streak king', '/longest-home-win-streaks', '']);
    expect(named('https://drewhoover.com/hostile-territory/coach/lane-kiffin/?q=Kiffin&min=1', 'hostile-territory'))
      .toEqual(['hostile territory', '/coach/lane-kiffin', 'q=Kiffin&min=1']);
    expect(named('https://drewhoover.com/cfb-all-time-records/?sort=winPct', 'cfb-all-time-records'))
      .toEqual(['all-time records', '/', 'sort=winPct']);
  });

  it('reads a site it has never seen as its slug in words', () => {
    // "streak king" is the numbers screen's own label for it (PATHS), not a second copy here
    expect(named('https://drewhoover.com/how-many-rings/?open=scott-cochran', 'how-many-rings'))
      .toEqual(['how many rings', '/', 'open=scott-cochran']);
  });

  it('names Putting Up Numbers by sport, and its home by itself though the home sends a sport', () => {
    expect(named('https://puttingupnumbers.com/cfb/teams/michigan/quarterbacks/', 'puttingupnumbers', 'cfb'))
      .toEqual(['PUN CFB', '/teams/michigan/quarterbacks', '']);
    expect(named('https://puttingupnumbers.com/european-clubs/players/x/', 'puttingupnumbers', 'soccer'))
      .toEqual(['PUN SOCCER', '/players/x', '']);
    expect(named('https://puttingupnumbers.com/', 'puttingupnumbers', 'nba')).toEqual(['PUN', '/', '']);
  });

  it('calls the blog the blog and anything else its host', () => {
    expect(named('https://drewhoover.com/blog/bfme2-apple-silicon/')).toEqual(['blog', '/bfme2-apple-silicon', '']);
    expect(named('https://www.drewhoover.com/about/')).toEqual(['drewhoover.com', '/about', '']);
  });

  it('decodes the query string', () => {
    expect(named('https://drewhoover.com/cfb-streak-king/?c=fullmoon%2Cvsmascot%3Acanine&q=a+b', 'cfb-streak-king')[2])
      .toBe('c=fullmoon,vsmascot:canine&q=a b');
  });

  it('leaves a utm tag out of the query and in the address', () => {
    const tagged = addressOf('https://puttingupnumbers.com/nba/fastest-to-10000-points/?utm_source=chatgpt.com&t=4871145', 'puttingupnumbers', 'nba');
    expect([tagged.page, tagged.query]).toEqual(['/fastest-to-10000-points', 't=4871145']);
    expect(tagged.href).toContain('utm_source=chatgpt.com');
  });

  it('keeps an address it cannot parse', () => {
    expect(named('not a url', 'hostile-territory')).toEqual(['hostile-territory', 'not a url', '']);
  });
});

describe('where a visit came from', () => {
  it('is direct without a referrer', () => {
    expect(sourceName()).toBe('direct');
    expect(sourceName('$direct')).toBe('direct');
  });
  it('reads the tag before the referrer', () => {
    expect(sourceName('https://www.google.com/', 'chatgpt.com')).toBe('chatgpt');
  });
  it('is one reddit for every reddit host', () => {
    for (const r of ['https://www.reddit.com/', 'https://old.reddit.com/r/CFB/', 'https://out.reddit.com/x', 'android-app://com.reddit.frontpage/']) {
      expect(sourceName(r)).toBe('reddit');
    }
  });
  it('shortens a bare host and keeps a path', () => {
    expect(sourceName('https://www.google.com/')).toBe('google');
    expect(sourceName('https://search.yahoo.com/')).toBe('search.yahoo');
    expect(sourceName('https://api.microsoft.ai/')).toBe('api.microsoft.ai');
    expect(sourceName('https://www.on3.com/boards/threads/123/')).toBe('on3.com/boards/threads/123');
    expect(sourceName('https://drewhoover.com/sports/')).toBe('drewhoover.com/sports');
  });
});

describe('where and what the browser was', () => {
  it('abbreviates a US state and names the country elsewhere', () => {
    expect(placeName('Chicago', 'Illinois', 'US')).toBe('Chicago, IL');
    expect(placeName('Stockholm', 'Stockholm County', 'SE')).toBe('Stockholm, SE');
    expect(placeName(undefined, 'Louisiana', 'US')).toBe('Louisiana');
    expect(placeName(undefined, undefined, 'CR')).toBe('CR');
  });
  it('falls back from the device to the OS', () => {
    expect(deviceName('iPhone', 'iOS')).toBe('iPhone');
    expect(deviceName(undefined, 'Mac OS X')).toBe('Mac');
    expect(deviceName(undefined, 'Windows')).toBe('Windows');
  });
});
