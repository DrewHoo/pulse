import { countBy, uniq } from 'es-toolkit';
import { DIRECT } from '../worker/names';
import { ago, esc, topBar } from './render';
import type { Arrival, EventTotal, Landing, PageSeen, Visit, Visitor, Visitors } from './stats';

// The visitors screen: the count, a chip a site, the arrivals, and a card a
// visitor, latest first. The worker has done the shaping (worker/visitors.ts);
// this draws it. specs/visitors.spec.md, chunks 2 to 4, has the layout.

/** What the reader has picked on the screen. main.ts holds it and wires the taps. */
export interface VisitorsView {
  site: string | null;           // the lit chip's site, or every site
  landing: LandingPicked | null; // the arrivals' landing page the cards are narrowed to
  open: string | null;           // the opened card, by shortId
  wide: boolean;                 // a desktop: the opened visitor reads in a pane beside the list, not inside its card
}
export interface LandingPicked { source: string; site: string; page: string; query: string }

const ARRIVALS_SHOWN = 7;
const CARDS_SHOWN = 150;

// A visitor's id as the URL and the card carry it.
const shortId = (visitor: Visitor) => visitor.id.slice(0, 8);

const DOT = '<span class="dot">·</span>';
const ARROW = '<span class="dot">→</span>';
const dotted = (parts: string[]) => parts.filter(Boolean).join(` ${DOT} `);

// "9:29a", in the phone's own timezone.
function clock(at: number, seconds = false): string {
  const time = new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) });
  return time.replace(/\s?AM$/, 'a').replace(/\s?PM$/, 'p');
}

function duration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return seconds % 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds / 60}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

const few = (values: string[], shown = 3) =>
  (values.length > shown ? `${values.slice(0, shown).join(', ')} +${values.length - shown}` : values.join(', '));

const times = (n: number) => (n > 1 ? `<span class="x">×${n}</span>` : '');
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
// A source in sky, unless the visit came direct: "reddit", and "from reddit" in a sentence.
const sourceWords = (source: string) => (source === DIRECT ? DIRECT : `<span class="src">${esc(source)}</span>`);
const from = (source: string) => (source === DIRECT ? DIRECT : `from ${sourceWords(source)}`);
const isNew = (flag: boolean) => (flag ? ' <mark>new</mark>' : '');

// "1m 2s · 50%", the seconds marked ~ when no leave measured them.
function timeInView(v: Visit): string {
  if (v.seconds <= 0) return '';
  const measured = v.scroll !== null;
  return dotted([`${duration(v.seconds)}${measured ? '' : '~'}`, measured ? `${v.scroll}%` : '']);
}

// ---------------------------------------------------------------------------
// A card's two summary lines
// ---------------------------------------------------------------------------

// The landing first. A parent with its children reads "/coach/ 4: kirby-smart, kalen-deboer +2".
function pagesLine(v: Visit): string {
  const parts = v.pageGroups.map((g) => (g.children.length === 0
    ? `${esc(g.path)}${times(g.views)}`
    : `${esc(g.path)}<span class="x">${g.children.length}:</span> ${esc(few(g.children, 2))}`));
  return dotted(parts.map((part, i) => (i === 0 ? `<b>${part}</b>` : part)));
}

// The filters, then the events with the one property the worker picked for a card.
function filtersAndEventsLine(v: Visit): string {
  const filters = v.filters.map((f) => `${esc(f.name)} <em>${esc(few(f.values))}</em>`);
  const events = v.eventTotals.filter((e) => !e.namedForFilter).map((e) =>
    `${esc(e.name)}${times(e.count)}${e.cardValues.length > 0 ? ` <em>${esc(few(e.cardValues))}</em>` : ''}`);
  return dotted([...filters, ...events]);
}

// ---------------------------------------------------------------------------
// The opened card
// ---------------------------------------------------------------------------

// One row a page, linking to the address in its last state, with the other
// states it was seen in under it.
function pageRow(p: PageSeen, v: Visit): string {
  const last = p.states.at(-1)!;
  const others = p.states.slice(0, -1);
  const isAt = (a: { site: string; page: string }) => a.site === p.site && a.page === p.page;
  const tags = [isAt(v.landing) ? 'landed' : '', isAt(v.left) ? 'left' : ''].filter(Boolean).join(', ');
  const link = (href: string, words: string) => `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${words}</a>`;
  const elsewhere = p.site === v.landing.site ? '' : `<small class="site">${esc(p.site)}</small> `;
  return `
    <div class="pg">${elsewhere}${link(last.href, `${esc(p.page)}${last.query ? `<q>?${esc(last.query)}</q>` : ''}`)}${tags ? `<small>${tags}</small>` : ''}<span>${p.views > 1 ? `×${p.views}` : ''}</span></div>
    ${others.length === 0 ? '' : `<div class="states"><span>also</span>${others.map((s) => link(s.href, s.query ? `?${esc(s.query)}` : 'no filter')).join('')}</div>`}`;
}

// An event with one property of its own shows the values alone.
function eventTotalRow(e: EventTotal): string {
  const values = e.properties.length === 1
    ? esc(few(e.properties[0]!.values, 4))
    : dotted(e.properties.map((p) => `${esc(p.name)} ${esc(few(p.values))}`));
  return `<div class="total"><b>${esc(e.name)}</b><span>×${e.count}</span><em>${values}</em></div>`;
}

// A visit's three blocks: its pages, its events by name, and every event
// behind a tap. `key` names the visit, so its open lists stay open over a refresh.
function visitBlocks(v: Visit, key: string): string {
  const rest = v.eventCount - v.events.length;
  return `
    <h4>Pages <span>${v.views} views${v.passing ? `, ${v.passing} passing through` : ''}</span></h4>
    ${v.pages.map((p) => pageRow(p, v)).join('')}
    ${v.eventTotals.length === 0 ? '' : `<h4>Events</h4>${v.eventTotals.map(eventTotalRow).join('')}`}
    <details data-key="events ${key}">
      <summary>${v.eventCount === 1 ? 'The 1 event' : `All ${v.eventCount} events`}</summary>
      ${v.events.map((e) => `<div class="ev${e.passing ? ' passing' : ''}${e.view ? ' view' : ''}"><time>${clock(e.at, true).replace(/[ap]$/, '')}</time><b>${e.view ? 'view' : esc(e.name)}</b><span>${esc(e.detail)}</span></div>`).join('')}
      ${rest > 0 ? `<div class="more">${rest} more</div>` : ''}
    </details>`;
}

// Only what the card's first two lines don't say, then the latest visit's
// blocks, then each earlier visit closed under its own line.
function opened(visitor: Visitor): string {
  const [latest, ...earlier] = visitor.visits as [Visit, ...Visit[]];
  const id = shortId(visitor);
  const facts = dotted([
    esc(visitor.browser), esc(visitor.screen), `${clock(latest.start)}–${clock(latest.end)}`,
    latest.scroll === null ? '' : plural(latest.taps, 'tap'),
    visitor.firstSource === latest.source ? '' : `first came ${from(visitor.firstSource)}`,
    id,
  ]);
  return `
  <div class="detail">
    <p class="facts">${facts}</p>
    ${visitBlocks(latest, `${id} ${latest.start}`)}
    ${earlier.map((v) => `
    <details data-key="visit ${id} ${v.start}">
      <summary>${dotted([`${clock(v.start)}–${clock(v.end)}`, esc(v.landing.site), from(v.source), timeInView(v)])}</summary>
      ${visitBlocks(v, `${id} ${v.start}`)}
    </details>`).join('')}
  </div>`;
}

// A visitor's first two lines: the site with time in view and the last
// event's time, then the place, the device and the source.
function headLines(visitor: Visitor): string {
  const v = visitor.visits[0]!;
  return `
      <span class="first"><b class="site">${esc(v.landing.site)}</b><span class="when">${dotted([timeInView(v), `<b>${clock(v.end)}</b>`])}</span></span>
      <span class="meta">${dotted([esc(visitor.place), esc(visitor.device), from(v.source), visitor.visits.length > 1 ? `${visitor.visits.length} visits` : ''])}</span>`;
}

// On a phone the opened card's blocks take the place of its two summary
// lines. On a desktop the card keeps them and the blocks go to the pane.
function card(visitor: Visitor, view: VisitorsView): string {
  const v = visitor.visits[0]!;
  const id = shortId(visitor);
  const isOpen = view.open === id;
  const openInPlace = isOpen && !view.wide;
  const summary = filtersAndEventsLine(v);
  return `
  <article class="who${v.onePage ? ' one-page' : ''}${isOpen ? ' open' : ''}">
    <button type="button" class="head" data-open="${esc(id)}" aria-expanded="${isOpen}">${headLines(visitor)}
      ${openInPlace ? '' : `<span class="pages">${pagesLine(v)}</span>${summary ? `<span class="did">${summary}</span>` : ''}`}
    </button>
    ${openInPlace ? opened(visitor) : ''}
  </article>`;
}

// A desktop's third column: the opened visitor, whichever chip is lit.
function pane(visitor: Visitor | undefined): string {
  if (!visitor) return `<aside class="pane nobody">Pick a visitor to read their pages and events here.</aside>`;
  return `
  <aside class="pane" data-id="${esc(shortId(visitor))}">
    <div class="head">${headLines(visitor)}</div>
    ${opened(visitor)}
  </aside>`;
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

const landedOn = (v: Visit, l: LandingPicked) =>
  v.source === l.source && v.landing.site === l.site && v.landing.page === l.page && v.landing.query === l.query;

// The site chips: every site a listed visit landed on, with its visitors.
function chips(visitors: Visitor[], lit: string | null): string {
  const sitesOf = (visitor: Visitor) => uniq(visitor.visits.map((v) => v.landing.site));
  const visitorsOn = countBy(visitors.flatMap(sitesOf), (site) => site);
  const sites = Object.entries(visitorsOn).map(([site, count]) => ({ site, visitors: count })).sort((a, b) => b.visitors - a.visitors);
  const chip = (site: string | null, words: string) =>
    `<button type="button" data-site="${esc(site ?? '')}" class="${site === lit ? 'on' : ''}" aria-pressed="${site === lit}">${esc(words)}</button>`;
  return `<nav class="paths" aria-label="sites">${chip(null, `all ${visitors.length}`)}${sites.map((s) => chip(s.site, `${s.site} ${s.visitors}`)).join('')}</nav>`;
}

// A row a source and site. It opens to its landing pages, and a landing page
// narrows the cards to the visits that landed there.
function arrivalRow(a: Arrival, index: number): string {
  const landing = (l: Landing, at: number) => `
    <button type="button" class="row landing" data-landing="${index} ${at}">
      <span class="name">${esc(l.page)}${l.query ? `<q>?${esc(l.query)}</q>` : ''}${isNew(l.isNew && !a.isNew)}</span><span class="n">${l.visitors}</span><span class="w"></span>
    </button>`;
  return `
  <details class="arrival" data-key="arrival ${esc(a.source)} ${esc(a.site)}">
    <summary class="row">
      <span class="name">${sourceWords(a.source)} ${ARROW} ${esc(a.site)}${isNew(a.isNew)}</span>
      <span class="n">${a.visitors}</span><span class="w">${a.yesterday}</span>
    </summary>
    ${a.landings.map(landing).join('')}
  </details>`;
}

function arrivals(s: Visitors): string {
  if (s.arrivals.length === 0) return '';
  const rows = s.arrivals.map(arrivalRow);
  const rest = rows.slice(ARRIVALS_SHOWN);
  return `
  <section class="list arrivals">
    <header><h2>Arrivals</h2><span class="n">vis</span><span class="w">yday</span></header>
    ${rows.slice(0, ARRIVALS_SHOWN).join('')}
    ${rest.length === 0 ? '' : `<details data-key="arrivals rest"><summary class="more">${rest.length} more</summary>${rest.join('')}</details>`}
    <p class="foot">Visits by where they came from and the site they landed on. yday is the same ${s.hours} hours yesterday; new has no arrival in the two days before. A row opens to its landing pages.</p>
  </section>`;
}

/** The landing page a tap on an arrivals row picked, from the row's `data-landing`. */
export function landingAt(s: Visitors, picked: string): LandingPicked | null {
  const [arrival, landing] = picked.split(' ').map(Number);
  const a = s.arrivals[arrival ?? -1];
  const l = a?.landings[landing ?? -1];
  return a && l ? { source: a.source, site: a.site, page: l.page, query: l.query } : null;
}

export function renderVisitors(s: Visitors, view: VisitorsView, failure = ''): string {
  const note = failure || (s.staleSince ? `Mixpanel didn't answer (likely its hourly limit): visitors from ${ago(s.staleSince)}` : '');
  const { site, landing } = view;
  const shown = s.visitors.filter((visitor) =>
    visitor.visits.some((v) => (site === null || v.landing.site === site) && (landing === null || landedOn(v, landing))));
  const cards = shown.map((visitor) => card(visitor, view));
  const rest = cards.slice(CARDS_SHOWN);
  const asOf = `as of ${clock(Date.parse(s.fetchedAt))} · <span id="ago">${ago(s.fetchedAt)}</span>`;
  return `
  ${topBar('visitors', asOf)}
  ${note ? `<p class="note">${esc(note)}</p>` : ''}
  <p class="lede"><b>${s.visitors.length}</b>visitors in the last ${s.hours} hours ${DOT} real users only</p>
  ${chips(s.visitors, site)}
  <div class="columns">
  ${arrivals(s)}
  <section class="people">
    <h2>Visitors, latest first</h2>
    ${landing === null ? '' : `<button type="button" class="narrowed" data-landing="">${from(landing.source)} ${ARROW} ${esc(landing.site)} ${esc(landing.page)}${landing.query ? `?${esc(landing.query)}` : ''} <span class="x">✕</span></button>`}
    ${cards.length === 0 ? `<div class="empty">nobody ${site !== null || landing !== null ? 'matches' : `in the last ${s.hours} hours`}</div>` : cards.slice(0, CARDS_SHOWN).join('')}
    ${rest.length === 0 ? '' : `<details data-key="cards rest"><summary class="more">show the other ${rest.length}</summary>${rest.join('')}</details>`}
  </section>
  ${view.wide ? pane(s.visitors.find((visitor) => shortId(visitor) === view.open)) : ''}
  </div>`;
}
