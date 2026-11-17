import { describe, expect, it } from 'vitest';
import {
  aiName, BOT_AGENT, BOT_ID, DREW_CITY, DREW_DEVICES, outsideName, pageName, previewsOf, REAL_JQL, realWhere, redditLink,
  siteName, type Series,
} from './shape';
import { addDays, localNow } from './time';

const series = (values: Record<string, Record<string, number>>): Series => ({ data: { series: [], values } });

const previews = previewsOf({
  shares: series({
    imessage: { '2026-10-09': 3, '2026-10-11': 2 },
    discord: { '2026-10-10': 4 },
    google: { '2026-10-11': 30 }, // a search crawler, not a share
    'other-bot': { '2026-10-11': 12 },
    slack: { '2026-10-08': 0 },
  }),
  reddit: series({
    // a link post: pasted into the form, submitted four minutes later, then its text fetched
    'https://drewhoover.com/cfb-streak-king/?t=texas&c=home%2Cunranked&scope=active': { '2026-10-10 21:00:00': 2, '2026-10-11 09:00:00': 1 },
    'https://drewhoover.com/cfb-streak-king/?t=texas&amp;c=home%2Cunranked&amp;scope=active': { '2026-10-10 22:00:00': 1 },
    // a markdown link in a comment, its closing paren caught
    'https://drewhoover.com/cfb-streak-king/?dir=L&amp;c=ranked)': { '2026-10-11 08:00:00': 1, '2026-10-10 08:00:00': 0 },
    'undefined': { '2026-10-11 08:00:00': 4 },
  }),
}, '2026-10-11');

describe('the link previews', () => {
  it('lists link previews by chat or social app, without the crawlers', () => {
    expect(previews.shares).toEqual([
      { name: 'iMessage', today: 2, week: 5 },
      { name: 'Discord', today: 0, week: 4 },
    ]);
  });

  it('lists the links Reddit fetched, a fetch within two hours of the last one the same lead', () => {
    expect(previews.redditLinks).toEqual([
      { at: '2026-10-11 09', url: 'https://drewhoover.com/cfb-streak-king/?t=texas&c=home%2Cunranked&scope=active', crawler: 1, text: 0 },
      { at: '2026-10-11 08', url: 'https://drewhoover.com/cfb-streak-king/?dir=L&c=ranked', crawler: 0, text: 1 },
      { at: '2026-10-10 21', url: 'https://drewhoover.com/cfb-streak-king/?t=texas&c=home%2Cunranked&scope=active', crawler: 2, text: 1 },
    ]);
  });
});

describe('pageName', () => {
  it('drops the filter\'s path from a page, and only a whole segment of it', () => {
    expect(pageName('/cfb-streak-king/', 'cfb-streak-king')).toBe('/');
    expect(pageName('/cfb-streak-king/games/week/7/', 'cfb-streak-king')).toBe('/games/week/7/');
    expect(pageName('/hostile-territory/', 'hostile-territory')).toBe('/');
    expect(pageName('/blog/bfme2-apple-silicon/', 'blog')).toBe('/bfme2-apple-silicon/');
    expect(pageName('/blogroll/', 'blog')).toBe('/blogroll/');
    expect(pageName('/intro', 'breathing-index')).toBe('/intro');
    expect(pageName('/cfb-streak-king/', 'all')).toBe('/cfb-streak-king/');
    expect(pageName('undefined', 'blog')).toBe('(no path)');
  });
});

describe('aiName', () => {
  it('names an assistant by its tag or its domain', () => {
    expect(aiName('chatgpt.com')).toBe('ChatGPT');
    expect(aiName('chat.openai.com')).toBe('ChatGPT');
    expect(aiName('perplexity')).toBe('Perplexity');
    expect(aiName('www.perplexity.ai')).toBe('Perplexity');
    expect(aiName('claude.ai')).toBe('Claude');
    expect(aiName('gemini.google.com')).toBe('Gemini');
    expect(aiName('copilot.microsoft.com')).toBe('Copilot');
    expect(aiName('google.com')).toBe('');
    expect(aiName('undefined')).toBe('');
  });
});

describe('redditLink', () => {
  it('unescapes &amp; and trims what a sentence leaves on the end', () => {
    expect(redditLink('https://x.test/?a=1&amp;b=2)')).toBe('https://x.test/?a=1&b=2');
    expect(redditLink('https://x.test/?c=home%2Cleadhalf%3A1),')).toBe('https://x.test/?c=home%2Cleadhalf%3A1');
  });
});

describe('outsideName', () => {
  it('drops scheme, www and trailing slash, keeps the path', () => {
    expect(outsideName('https://www.reddit.com/')).toBe('reddit.com');
    expect(outsideName('https://old.reddit.com/r/rolltide/comments/1x1km4m/thread/')).toBe('old.reddit.com/r/rolltide/comments/1x1km4m/thread');
    expect(outsideName('android-app://com.reddit.frontpage/')).toBe('com.reddit.frontpage');
    expect(outsideName('not a url')).toBe('not a url');
  });
});

describe('time', () => {
  it('reads the clock in the project timezone', () => {
    expect(localNow('America/New_York', new Date('2026-10-11T03:30:00Z'))).toEqual({
      date: '2026-10-10', hour: 23, minute: 30, tz: 'America/New_York',
    });
    expect(localNow('America/New_York', new Date('2026-10-11T04:05:00Z')).hour).toBe(0);
  });
  it('adds days across month and year ends', () => {
    expect(addDays('2026-10-11', -6)).toBe('2026-10-05');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });
});

describe('who counts', () => {
  // REAL_JQL run the way JQL runs it, with the lists as params
  const real = new Function('params', `${REAL_JQL}; return real;`)({
    drewDevices: DREW_DEVICES, drewCity: DREW_CITY, botId: BOT_ID, botAgent: BOT_AGENT,
  }) as (e: { distinct_id: string; properties: Record<string, unknown> }) => boolean;
  const reader = { $os: 'iOS', $screen_width: 390, $screen_height: 844, $city: 'Chicago', user_agent: 'Mozilla/5.0 (iPhone)' };
  const ev = (properties: Record<string, unknown>, distinct_id = '$device:reader') => ({ distinct_id, properties });

  it('keeps a reader', () => {
    expect(real(ev(reader))).toBe(true);
    expect(real(ev({ ...reader, $os: 'Mac OS X', $screen_width: 1512, $screen_height: 982 }))).toBe(true);
  });

  it("drops Drew's devices and the agent test browsers", () => {
    expect(real(ev(reader, DREW_DEVICES[0]!))).toBe(false);
    expect(real(ev({ ...reader, $city: 'North Haven' }))).toBe(false);
  });

  it('drops the bots Bot Check names, and the headless Mac at 1440x900', () => {
    expect(real(ev(reader, 'crawl:bingbot'))).toBe(false);
    expect(real(ev({ ...reader, user_agent: 'Mozilla/5.0 HeadlessChrome/146' }))).toBe(false);
    expect(real(ev({ ...reader, framed: true }))).toBe(false);
    expect(real(ev({ ...reader, $screen_width: 800, $screen_height: 600 }))).toBe(false);
    expect(real(ev({ ...reader, $os: 'Linux', $screen_width: 1920, $screen_height: 1080, $city: undefined }))).toBe(false);
    expect(real(ev({ ...reader, $os: 'Mac OS X', $screen_width: 1440, $screen_height: 900, $city: 'Princeton' }))).toBe(false);
  });

  it('says the same rules to the segmentation API', () => {
    expect(realWhere).toMatch(/^not \(/);
    for (const id of DREW_DEVICES) expect(realWhere).toContain(id);
    expect(realWhere).toContain('properties["$os"] == "Mac OS X" and properties["$screen_width"] == 1440 and properties["$screen_height"] == 900');
    expect(realWhere).toContain('"headless" in lower(properties["user_agent"])');
  });
});

describe('Putting Up Numbers', () => {
  it('names each filter by its site', () => {
    expect(siteName('puttingupnumbers')).toBe('puttingupnumbers.com');
    expect(siteName('breathing-index')).toBe('breathingindex.com');
    expect(siteName('cfb-streak-king')).toBe('drewhoover.com');
    expect(siteName('all')).toBe('drewhoover.com');
  });
});
