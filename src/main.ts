import './styles.css';
import { ago, isScreen, render, renderMessage, type Screen } from './render';
import { CARDS_SHOWN, landingAt, renderVisitors, type VisitorsView } from './visitors';
import { isSort, renderLandings, ROWS_SHOWN, type LandingsView } from './landings';
import { DEFAULT_PATH, isPathKey, type PathKey } from '../worker/shape';
import type { Landings, Span, Stats, Visitors } from './stats';
import { isSpan } from '../worker/spans';
import { fetchEnded, fetchingIcon, fetchStarted } from './fetching';

// The page is a static shell on GitHub Pages. Everything it shows comes from
// the worker at ./api/, gated by a bearer token. The token arrives once in
// the URL (?k=…), stays there so an iOS "Add to Home Screen" bookmark keeps
// it (the installed app gets its own storage, separate from Safari's), and is
// mirrored to localStorage as a fallback for a bookmark that lost its query.
//
// The page has three screens, the numbers, the visitors (?v=visitors) and the
// landings (?v=landings), and polls only the one it shows. The numbers
// screen's path picker (?p=), the visitors screen's span (?span=week) and its
// opened card (?d=), and the landings screen's site (?site=) and sort (?sort=)
// ride in the URL the same way, and localStorage remembers the screen, the
// path and the span for a bookmark without them.
// Each screen and each path filter keeps its own last answer, so switching
// paints at once and then refreshes.

const API = `${import.meta.env.BASE_URL}api/`;
const TOKEN_KEY = 'pulse.token';
const SCREEN_KEY = 'pulse.screen';
const PATH_KEY = 'pulse.path';
const SPAN_KEY = 'pulse.span';
const LAST_KEY = 'pulse.last.v6';         // versioned with the stats shape, so an old cached answer is not painted
const VISITORS_KEY = 'pulse.visitors.v2'; // and this with the visitors shape
const LANDINGS_KEY = 'pulse.landings.v1'; // and this with the landings shape
const REFRESH_MS = 5 * 60 * 1000;
const STALE_MS = 60 * 1000;

const root = document.getElementById('app')!;

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode, or full */ } },
};
function stored<T>(k: string): T | null {
  const last = store.get(k);
  if (!last) return null;
  try { return JSON.parse(last) as T; } catch { return null; }
}

// Every write of a screen goes through here, so the fetching icon, made once,
// goes back in its place in the header.
function draw(markup: string) {
  root.innerHTML = markup;
  root.querySelector('#fetching')?.replaceWith(fetchingIcon);
}

const param = (name: string) => new URLSearchParams(location.search).get(name);

// Sets or clears query parameters in place, keeping the token and the rest.
function setParams(changes: Record<string, string | null>) {
  const q = new URLSearchParams(location.search);
  for (const [name, v] of Object.entries(changes)) {
    if (v === null) q.delete(name); else q.set(name, v);
  }
  const search = q.toString();
  history.replaceState(null, '', `${location.pathname}${search ? `?${search}` : ''}${location.hash}`);
}

// In dev, Vite's proxy sends the token (vite.config.ts), so the page asks without one.
const PROXY_SENDS_TOKEN = 'dev';

function token(): string | null {
  const fromUrl = param('k');
  if (fromUrl) { store.set(TOKEN_KEY, fromUrl); return fromUrl; }
  return store.get(TOKEN_KEY) ?? (import.meta.env.DEV ? PROXY_SENDS_TOKEN : null);
}

function initialScreen(): Screen {
  const fromUrl = param('v');
  if (isScreen(fromUrl)) return fromUrl;
  const saved = store.get(SCREEN_KEY);
  return isScreen(saved) ? saved : 'numbers';
}

function initialPath(): PathKey {
  const fromUrl = param('p');
  if (isPathKey(fromUrl)) return fromUrl;
  const saved = store.get(PATH_KEY);
  return isPathKey(saved) ? saved : DEFAULT_PATH;
}

function initialSpan(): Span {
  const fromUrl = param('span');
  if (isSpan(fromUrl)) return fromUrl;
  const saved = store.get(SPAN_KEY);
  return isSpan(saved) ? saved : 'today';
}

let screen: Screen = initialScreen();
let path: PathKey = initialPath();
const lastKey = (p: PathKey) => `${LAST_KEY}.${p}`;
let stats: Stats | null = stored<Stats>(lastKey(path));
const visitorsKey = (span: Span) => `${VISITORS_KEY}.${span}`;
// A desktop's width. The visitors screen then reads as columns, the opened
// visitor in a pane of its own (styles.css, `main.wide`).
const desktop = matchMedia('(min-width: 1000px)');
const view: VisitorsView = { span: initialSpan(), cards: CARDS_SHOWN, site: null, landing: null, open: param('d'), wide: desktop.matches };
let visitors: Visitors | null = stored<Visitors>(visitorsKey(view.span));
const paramSort = param('sort');
const landingsView: LandingsView = { site: param('site'), sort: isSort(paramSort) ? paramSort : 'visits', rows: ROWS_SHOWN };
let landings: Landings | null = stored<Landings>(LANDINGS_KEY);

let fetchedLocal = 0;
let inflight: Promise<void> | null = null;

// What a fetch is for. An answer for a screen or a filter the page has since left is dropped.
const showing = () => ({ numbers: `numbers ${path}`, visitors: `visitors ${view.span}`, landings: 'landings' })[screen];
const answer = () => ({ numbers: stats, visitors, landings })[screen];
const apiUrl = () => ({
  numbers: `${API}stats?path=${encodeURIComponent(path)}`,
  visitors: `${API}visitors${view.span === 'today' ? '' : `?span=${view.span}`}`,
  landings: `${API}landings`,
})[screen];

function html(note: string): string {
  if (screen === 'visitors') return visitors ? renderVisitors(visitors, view, note) : renderMessage(screen, 'pulse', note || 'loading…');
  if (screen === 'landings') return landings ? renderLandings(landings, landingsView, note) : renderMessage(screen, 'pulse', note || 'loading…');
  return stats ? render(stats, note, path) : renderMessage(screen, 'pulse', note || 'loading…', path);
}

// A repaint replaces the whole screen, so it puts back what the reader had: a
// list they opened (a card's events, an arrivals row), and how far down the
// desktop's pane they were, if it still shows the same visitor.
function paint(note = '') {
  const keys = (selector: string) => [...root.querySelectorAll<HTMLDetailsElement>(selector)].map((d) => d.dataset.key);
  const open = new Set(keys('details[open][data-key]'));
  const paneOf = () => root.querySelector<HTMLElement>('.pane');
  const before = { id: paneOf()?.dataset.id, scrollTop: paneOf()?.scrollTop ?? 0 }; // read now: a removed element scrolls to 0
  root.classList.toggle('wide', view.wide);
  draw(html(note));
  for (const d of root.querySelectorAll<HTMLDetailsElement>('details[data-key]')) d.open = open.has(d.dataset.key);
  const pane = paneOf();
  if (pane && pane.dataset.id === before.id) pane.scrollTop = before.scrollTop;
}

// After the screen or the path changed: paint its last answer, then fetch.
function repaintAndFetch() {
  fetchedLocal = 0;
  paint();
  void refresh(true);
}

function showScreen(next: Screen) {
  if (next === screen) return;
  screen = next;
  store.set(SCREEN_KEY, next);
  setParams({ v: next === 'numbers' ? null : next });
  repaintAndFetch();
}

function choosePath(next: PathKey) {
  if (next === path) return;
  path = next;
  store.set(PATH_KEY, next);
  setParams({ p: next === DEFAULT_PATH ? null : next });
  stats = stored<Stats>(lastKey(next));
  repaintAndFetch();
}

// A span starts over: its own last answer, the first cards, and no landing
// picked, since the arrivals' rows are the span's.
function chooseSpan(next: Span) {
  if (next === view.span) return;
  view.span = next;
  view.cards = CARDS_SHOWN;
  view.landing = null;
  store.set(SPAN_KEY, next);
  setParams({ span: next === 'today' ? null : next });
  visitors = stored<Visitors>(visitorsKey(next));
  repaintAndFetch();
}

// A tap on a card's head opens it, and a tap on the open one closes it.
function toggleCard(id: string) {
  view.open = view.open === id ? null : id;
  setParams({ d: view.open });
  paint();
}

// The landings screen's site and sort. A new one starts the list over at its first rows.
function narrowLandings(changes: Partial<Pick<LandingsView, 'site' | 'sort'>>) {
  Object.assign(landingsView, changes, { rows: ROWS_SHOWN });
  setParams({ site: landingsView.site, sort: landingsView.sort === 'visits' ? null : landingsView.sort });
  paint();
}

// Every tap the screens wire, by the attribute on what was tapped.
root.addEventListener('click', (e) => {
  const tapped = (e.target as Element).closest<HTMLElement>('#refresh, [data-screen], [data-path], [data-span], [data-more], [data-site], [data-landing], [data-open], [data-of-site], [data-sort], [data-more-rows]');
  if (!tapped) return;
  const { site, landing, open, ofSite } = tapped.dataset;
  const toSort = tapped.dataset.sort ?? null;
  const toScreen = tapped.dataset.screen ?? null;
  const toPath = tapped.dataset.path ?? null;
  const toSpan = tapped.dataset.span ?? null;
  if (tapped.id === 'refresh') void refresh(true);
  else if (isScreen(toScreen)) showScreen(toScreen);
  else if (isPathKey(toPath)) choosePath(toPath);
  else if (isSpan(toSpan)) chooseSpan(toSpan);
  else if (tapped.dataset.more !== undefined) { view.cards += CARDS_SHOWN; paint(); }
  else if (site !== undefined) { view.site = site || null; paint(); }
  else if (landing !== undefined) { view.landing = visitors && landing ? landingAt(visitors, landing) : null; paint(); }
  else if (open !== undefined) toggleCard(open);
  else if (ofSite !== undefined) narrowLandings({ site: ofSite || null });
  else if (isSort(toSort)) narrowLandings({ sort: toSort });
  else if (tapped.dataset.moreRows !== undefined) { landingsView.rows += ROWS_SHOWN; paint(); }
});

async function refresh(force = false): Promise<void> {
  if (inflight) return inflight;
  if (!force && Date.now() - fetchedLocal < STALE_MS) return;
  const k = token();
  if (!k) {
    draw(renderMessage(screen, 'no token', 'open this page once with ?k=<token> in the URL, then add it to the home screen from that address.'));
    return;
  }
  const want = showing();
  const url = apiUrl();
  const failed = (title: string, why: string, note: string) => {
    if (answer()) paint(note);
    else draw(renderMessage(screen, title, why, path));
  };
  let ok = false;
  fetchStarted();
  inflight = (async () => {
    try {
      const res = await fetch(url, { headers: { authorization: `Bearer ${k}` }, cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (want !== showing()) return; // the page moved on while this was in flight
      if (!res.ok) {
        const why = typeof body?.error === 'string' ? body.error : `${res.status} ${res.statusText}`;
        failed(res.status === 401 ? 'token rejected' : 'no data', why, `refresh failed: ${why}`);
        return;
      }
      if (screen === 'numbers') {
        stats = body as Stats;
        store.set(lastKey(path), JSON.stringify(stats));
      } else if (screen === 'visitors') {
        visitors = body as Visitors;
        store.set(visitorsKey(view.span), JSON.stringify(visitors));
      } else {
        landings = body as Landings;
        store.set(LANDINGS_KEY, JSON.stringify(landings));
      }
      fetchedLocal = Date.now();
      ok = true;
      paint();
    } catch (e) {
      if (want !== showing()) return;
      const why = e instanceof Error ? e.message : String(e);
      failed('offline', why, `offline: ${why}`);
    } finally {
      inflight = null;
      if (want !== showing()) void refresh(true); // fetch what is showing now, the icon still turning
      else fetchEnded(ok);
    }
  })();
  return inflight;
}

desktop.addEventListener('change', () => { view.wide = desktop.matches; paint(); });

// First paint from the last answer, so the installed app opens on numbers or
// cards, then the network replaces them.
paint();
void refresh(true);

setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, REFRESH_MS);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refresh(); });
window.addEventListener('focus', () => void refresh());
window.addEventListener('pageshow', () => void refresh());
setInterval(() => {
  const shown = answer();
  const el = document.getElementById('ago');
  if (el && shown) el.textContent = ago(shown.fetchedAt);
}, 15 * 1000);
