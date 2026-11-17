import { outsideName, PATHS, REDDIT_HOST } from './shape';

// What an event reads as on a phone: its site's label, the page under it, the
// query string apart, where the visit came from, and where the browser was.
// Every name is derived, so a new site, sport or referrer needs no change
// here. specs/visitors.spec.md, "Site and page names", has the table.

export interface Address {
  site: string;  // the site's label: "streak king", "PUN CFB"
  page: string;  // the path under the site, no trailing slash: "/coach/lane-kiffin", "/" for its root
  query: string; // the query string, decoded, without the "?" or a `utm_` tag
  href: string;  // the address as the browser had it
}

// A site's label is the one the numbers screen's picker gives it (PATHS), else
// this one, which a rule can't derive from the embed's `site`, else its slug in words.
const SITE_LABELS: Record<string, string> = { 'cfb-all-time-records': 'all-time records' };
const PUN_SITE = 'puttingupnumbers';
const PUN_HOST = 'puttingupnumbers.com';
const INDEX_HOST = 'drewhoover.com';

interface Site { label: string; base: string } // base: the path the site sits at, which its pages lose

function siteOf(url: URL, site?: string, sport?: string): Site {
  const host = url.hostname.replace(/^www\./, '');
  const firstSegment = url.pathname.split('/')[1] ?? '';
  if (site === PUN_SITE || host === PUN_HOST) {
    // the home's pageviews carry `sport: nba`, so the path says whether a sport is showing
    if (!firstSegment) return { label: 'PUN', base: '' };
    return { label: `PUN ${(sport ?? firstSegment).toUpperCase()}`, base: `/${firstSegment}` };
  }
  if (site) {
    const label = PATHS.find((p) => p.key === site)?.label ?? SITE_LABELS[site] ?? site.replaceAll('-', ' ');
    return { label, base: firstSegment === site ? `/${site}` : '' };
  }
  if (host === INDEX_HOST && firstSegment === 'blog') return { label: 'blog', base: '/blog' };
  return { label: host, base: '' };
}

// The query string as a reader would type it: decoded, and without the
// `utm_` tags a referrer adds, which say where the visit came from.
function decoded(search: string): string {
  const pairs = search.replace(/^\?/, '').split('&').filter((pair) => pair !== '' && !pair.startsWith('utm_'));
  const query = pairs.join('&').replace(/\+/g, ' ');
  try { return decodeURIComponent(query); } catch { return query; }
}

/** An event's `$current_url`, with the `site` and `sport` its embed registered. */
export function addressOf(href: string, site?: string, sport?: string): Address {
  let url: URL;
  try { url = new URL(href); } catch { return { site: site ?? '(no page)', page: href || '/', query: '', href }; }
  const { label, base } = siteOf(url, site, sport);
  const page = url.pathname.slice(base.length).replace(/\/+$/, '') || '/';
  return { site: label, page, query: decoded(url.search), href };
}

export const DIRECT = 'direct';

/**
 * Where a visit came from: its `utm_source` (ChatGPT sends one and no
 * referrer), else its referrer, else direct. Reddit's hosts are all "reddit".
 * A referrer with no path loses its `.com`, so google.com is "google"; one
 * with a path keeps it, so a thread reads as a thread.
 */
export function sourceName(referrer?: string, utmSource?: string): string {
  const bare = (host: string) => host.toLowerCase().replace(/^www\./, '').replace(/\.com$/, '');
  if (utmSource) return bare(utmSource);
  if (!referrer || referrer === '$direct') return DIRECT;
  let url: URL;
  try { url = new URL(referrer); } catch { return referrer; }
  if (REDDIT_HOST.test(url.hostname)) return 'reddit';
  const name = outsideName(referrer);
  return name.includes('/') ? name : bare(name);
}

/** "Chicago, IL" in the US, "Stockholm, SE" outside it, and whatever Mixpanel has when it lacks a city. */
export function placeName(city?: string, region?: string, country?: string): string {
  if (!city && !region) return country ?? 'somewhere';
  if (country !== 'US') return `${city ?? region}, ${country ?? '?'}`;
  const state = region ? US_STATES[region] ?? region : '';
  return city && state ? `${city}, ${state}` : city ?? region!;
}

/** Mixpanel's `$device` (iPhone, Android), else the OS, which is all a desktop has. */
export function deviceName(device?: string, os?: string): string {
  return device ?? (os === 'Mac OS X' ? 'Mac' : os) ?? 'unknown device';
}

const US_STATES: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT',
  Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL',
  Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD',
  Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT',
  Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA',
  'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT',
  Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
};
