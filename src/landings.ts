import { sumBy } from 'es-toolkit';
import { DIRECT } from '../worker/names';
import { QUICK_SECONDS, STAYED_SECONDS, STAYED_TAPS } from '../worker/thresholds';
import { heatAmong, type Heat } from './heat';
import { ago, duration, esc, topBar } from './render';
import { clock } from './visitors';
import type { Counts, LandingRow, Landings, SiteRow, SourceRow } from './stats';

// The landings screen: three lists with the same columns, a row a site, a row
// a source and a row a landing page. The worker has done the counting
// (worker/landings.ts); this sorts, filters and draws it.
// specs/landings.spec.md, chunk 2, has the layout.

export const SORTS = ['visits', 'quick', 'stayed'] as const;
export type Sort = (typeof SORTS)[number];
export const isSort = (s: string | null): s is Sort => SORTS.some((name) => name === s);

/** What the reader has picked on the screen. main.ts holds it and wires the taps. */
export interface LandingsView {
  site: string | null; // the lit site's row, or every site
  sort: Sort;          // the Landings list's order
  rows: number;        // how many landing rows show, raised by "show more"
}

export const ROWS_SHOWN = 30;
const SITES_SHOWN = 8;
const SOURCES_SHOWN = 8;
/** A share of fewer measured visits than this is small print, and sorts after the rest. */
const SHARE_FLOOR = 5;

const DOT = '<span class="dot">·</span>';
const ARROW = '<span class="dot">→</span>';
const dotted = (parts: string[]) => parts.filter(Boolean).join(` ${DOT} `);
const fmt = (n: number) => n.toLocaleString('en-US');
const sourceWords = (source: string) => (source === DIRECT ? DIRECT : `<span class="src">${esc(source)}</span>`);

const share = (n: number, c: Counts) => n / c.measured;

// The five numbers a row shows, as the tints compare them.
const COLUMN = {
  visits: (c: Counts) => c.visits,
  quick: (c: Counts) => share(c.quick, c),
  stayed: (c: Counts) => share(c.stayed, c),
  time: (c: Counts) => c.median,
  pages: (c: Counts) => c.pagesAVisit,
};
type Column = keyof typeof COLUMN;
type Tints = (c: Counts) => Record<Column, Heat>;
const COLUMNS_READ = Object.keys(COLUMN) as Column[];

// Each number's place in its column, among one list's rows. A row with fewer
// than SHARE_FLOOR measured visits is in no column and has no tint: its shares
// are one or two visits.
function tintsOf(rows: Counts[]): Tints {
  const compared = rows.filter((r) => r.measured >= SHARE_FLOOR);
  const among = (column: Column) => heatAmong(compared.map(COLUMN[column]).filter((v): v is number => v !== null));
  const heat = Object.fromEntries(COLUMNS_READ.map((column) => [column, among(column)])) as Record<Column, (v: number) => Heat>;
  return (c) => Object.fromEntries(COLUMNS_READ.map((column) => {
    const value = COLUMN[column](c);
    return [column, c.measured < SHARE_FLOOR || value === null ? '' : heat[column](value)];
  })) as Record<Column, Heat>;
}

const HEAT_WORDS: Record<Heat, string> = {
  '': '', most: "in the list's top tenth", more: "in the list's top quarter", less: "in the list's bottom quarter", least: "in the list's bottom tenth",
};

// A row's five numbers. Quick and stayed are shares of the measured visits: a
// dash with none, and small print under SHARE_FLOOR.
function numbers(c: Counts, tints: Tints): string {
  const few = c.measured < SHARE_FLOOR ? ' few' : '';
  const percent = (n: number) => (c.measured === 0 ? '–' : `${Math.round(share(n, c) * 100)}%`);
  const heat = tints(c);
  const cell = (kind: string, column: Column, words: string) =>
    `<span class="${kind}${heat[column] ? ` heat heat-${heat[column]}` : ''}"${heat[column] ? ` title="${HEAT_WORDS[heat[column]]}"` : ''}>${words}</span>`;
  return `
      ${cell('n', 'visits', fmt(c.visits))}
      ${cell(`s${few}`, 'quick', percent(c.quick))}
      ${cell(`s${few}`, 'stayed', percent(c.stayed))}
      ${cell(`t${few}`, 'time', c.median === null ? '–' : duration(c.median))}
      ${cell('p', 'pages', c.pagesAVisit.toFixed(1))}`;
}

const COLUMNS = `<span class="n">visits</span><span class="s">quick</span><span class="s">stayed</span><span class="t">time</span><span class="p">pages</span>`;

// ---------------------------------------------------------------------------
// Sites and sources
// ---------------------------------------------------------------------------

// A site's row filters the screen to it, and a second tap clears it. The lit
// site's row shows even when it's one of the smaller sites.
function sites(rows: SiteRow[], lit: string | null): string {
  const tints = tintsOf(rows);
  const row = (r: SiteRow) => `
    <button type="button" class="row pick${r.site === lit ? ' on' : ''}" data-of-site="${esc(r.site === lit ? '' : r.site)}" aria-pressed="${r.site === lit}">
      <span class="name">${esc(r.site)}</span>${numbers(r, tints)}
    </button>`;
  const shown = rows.filter((r, i) => i < SITES_SHOWN || r.site === lit);
  const rest = rows.filter((r) => !shown.includes(r));
  return `
  <section class="list counts">
    <header><h2>Sites</h2>${COLUMNS}</header>
    ${shown.map(row).join('')}
    ${rest.length === 0 ? '' : `<details data-key="sites rest"><summary class="more">${rest.length} more</summary>${rest.map(row).join('')}</details>`}
    <p class="foot">Visits of the last 7 days by the site they landed on. A row narrows the screen to its site.</p>
  </section>`;
}

function sources(rows: SourceRow[], site: string | null): string {
  const tints = tintsOf(rows);
  const row = (r: SourceRow) => `
    <div class="row">
      <span class="name">${sourceWords(r.source)}${site === null ? ` ${ARROW} ${esc(r.site)}` : ''}</span>${numbers(r, tints)}
    </div>`;
  const rest = rows.slice(SOURCES_SHOWN);
  return `
  <section class="list counts">
    <header><h2>Sources</h2>${COLUMNS}</header>
    ${rows.length === 0 ? '<div class="empty">no visits this week</div>' : rows.slice(0, SOURCES_SHOWN).map(row).join('')}
    ${rest.length === 0 ? '' : `<details data-key="sources rest"><summary class="more">${rest.length} more</summary>${rest.map(row).join('')}</details>`}
  </section>`;
}

// ---------------------------------------------------------------------------
// Landings
// ---------------------------------------------------------------------------

// By visits, or by a share. The rows under SHARE_FLOOR come after the rest
// and keep the worker's order, the most visits first, as a tie does.
function sorted(rows: LandingRow[], sort: Sort): LandingRow[] {
  if (sort === 'visits') return rows;
  const enough = (r: LandingRow) => r.measured >= SHARE_FLOOR;
  return [...rows.filter(enough).sort((a, b) => share(b[sort], b) - share(a[sort], a)), ...rows.filter((r) => !enough(r))];
}

const link = (href: string, words: string) => `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${words}</a>`;
const plural = (n: number, word: string) => `${fmt(n)} ${word}${n === 1 ? '' : 's'}`;

// What an opened row says: its pages when it's starred, then where its visits
// came from, where they went next, and the events they sent. A page under a
// star is tinted against the list's rows, as its own row would be.
function opened(r: LandingRow, tints: Tints): string {
  const line = (label: string, parts: string[]) => (parts.length === 0 ? '' : `<p><b>${label}</b><span>${dotted(parts)}</span></p>`);
  const next = r.next.map((to) => `${to.site === r.site ? '' : `<small class="site">${esc(to.site)}</small> `}${esc(to.page)} <i>${fmt(to.visitors)}</i>`);
  const alone = r.stopped === 0 ? [] : [`<span class="alone">${plural(r.stopped, 'visit')} saw no other page</span>`];
  return `
    <div class="went">
      ${r.href ? line('page', [link(r.href, esc(r.href.replace(/^https?:\/\//, '')))]) : ''}
      ${r.under.map((u) => `
      <div class="row under">
        <span class="name">${link(u.href, esc(u.page))}</span>${numbers(u, tints)}
      </div>`).join('')}
      ${line('from', r.sources.map((s) => `${sourceWords(s.source)} <i>${fmt(s.visits)}</i>`))}
      ${line('next', [...next, ...alone])}
      ${line('events', r.events.map((e) => `<em>${esc(e.name)}</em> <i>${fmt(e.visits)}</i>, ${fmt(e.stayed)} stayed`))}
    </div>`;
}

function landingRow(r: LandingRow, site: string | null, tints: Tints): string {
  return `
  <details class="landed-on" data-key="landing ${esc(r.site)} ${esc(r.page)}">
    <summary class="row">
      <span class="name">${site === null ? `<small class="site">${esc(r.site)}</small> ` : ''}${esc(r.page)}</span>${numbers(r, tints)}
    </summary>
    ${opened(r, tints)}
  </details>`;
}

function landings(rows: LandingRow[], view: LandingsView): string {
  const order = sorted(rows, view.sort);
  const tints = tintsOf(rows);
  const left = order.length - view.rows;
  const sorts = SORTS.map((sort) =>
    `<button type="button" data-sort="${sort}" class="${sort === view.sort ? 'on' : ''}" aria-pressed="${sort === view.sort}">${sort}</button>`).join(` ${DOT} `);
  return `
  <section class="list counts landings">
    <header><h2>Landings</h2>${COLUMNS}</header>
    <p class="sorts spans">sorted by ${sorts}</p>
    ${order.length === 0 ? '<div class="empty">no visits this week</div>' : order.slice(0, view.rows).map((r) => landingRow(r, view.site, tints)).join('')}
    ${left <= 0 ? '' : `<button type="button" class="more" data-more-rows>show ${Math.min(left, ROWS_SHOWN)} more of ${fmt(left)}</button>`}
    <p class="foot">A row is the page a visit landed on, with a * where pages alike but for one segment read as one. Quick is under ${QUICK_SECONDS} seconds on one page with no tap. Stayed is a second page, ${STAYED_SECONDS} seconds in view or ${STAYED_TAPS} taps. Both are shares of the visits that reported their time, and small print is fewer than ${SHARE_FLOOR} of them. Time is the median visit. A row opens to where its visits came from and went next.</p>
    <p class="foot key"><span class="heat heat-most">most</span><span class="heat heat-more">more</span><span class="heat heat-less">less</span><span class="heat heat-least">least</span> A tinted number is in the top or bottom quarter of its column in its list, and a stronger tint is the top or bottom tenth. The rows with ${SHARE_FLOOR} or more measured visits are the ones compared.</p>
  </section>`;
}

export function renderLandings(s: Landings, view: LandingsView, failure = ''): string {
  const note = failure || (s.staleSince ? `Mixpanel didn't answer (likely its hourly limit): landings from ${ago(s.staleSince)}` : '');
  const { site } = view;
  const on = <T extends { site: string }>(rows: T[]) => (site === null ? rows : rows.filter((r) => r.site === site));
  const visits = sumBy(on(s.sites), (r) => r.visits);
  const asOf = `as of ${clock(Date.parse(s.fetchedAt))} · <span id="ago">${ago(s.fetchedAt)}</span>`;
  return `
  ${topBar('landings', asOf)}
  ${note ? `<p class="note">${esc(note)}</p>` : ''}
  <p class="lede"><b>${fmt(visits)}</b>visits in 7 days${site === null ? '' : ` ${DOT} ${esc(site)}`} ${DOT} real users only</p>
  <div class="landing-columns">
    <div class="beside">
      ${sites(s.sites, site)}
      ${sources(on(s.sources), site)}
    </div>
    ${landings(on(s.landings), view)}
  </div>`;
}
