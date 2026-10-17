import './styles.css';
import { ago, render, renderMessage } from './render';
import { DEFAULT_PATH, isPathKey, type PathKey } from '../worker/shape';
import type { Stats } from './stats';

// The page is a static shell on GitHub Pages. Everything it shows comes from
// the worker at ./api/stats, gated by a bearer token. The token arrives once
// in the URL (?k=…), stays there so an iOS "Add to Home Screen" bookmark keeps
// it (the installed app gets its own storage, separate from Safari's), and is
// mirrored to localStorage as a fallback for a bookmark that lost its query.
//
// The path picker (?p=) works the same way: the URL carries the choice, and
// localStorage remembers it for a bookmark without one. Each filter keeps its
// own last answer, so switching paints numbers at once and then refreshes.

const API = `${import.meta.env.BASE_URL}api/stats`;
const TOKEN_KEY = 'pulse.token';
const PATH_KEY = 'pulse.path';
const LAST_KEY = 'pulse.last.v3'; // versioned with the stats shape, so an old cached answer is not painted
const REFRESH_MS = 5 * 60 * 1000;
const STALE_MS = 60 * 1000;

const root = document.getElementById('app')!;
let stats: Stats | null = null;
let fetchedLocal = 0;
let inflight: Promise<void> | null = null;

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

function token(): string | null {
  const fromUrl = new URLSearchParams(location.search).get('k');
  if (fromUrl) { store.set(TOKEN_KEY, fromUrl); return fromUrl; }
  return store.get(TOKEN_KEY);
}

function initialPath(): PathKey {
  const fromUrl = new URLSearchParams(location.search).get('p');
  if (isPathKey(fromUrl)) return fromUrl;
  const saved = store.get(PATH_KEY);
  return isPathKey(saved) ? saved : DEFAULT_PATH;
}

let path: PathKey = initialPath();
const lastKey = (p: PathKey) => `${LAST_KEY}.${p}`;

function loadLast(p: PathKey): Stats | null {
  const last = store.get(lastKey(p));
  if (!last) return null;
  try { return JSON.parse(last) as Stats; } catch { return null; }
}

function choose(next: PathKey) {
  if (next === path) return;
  path = next;
  store.set(PATH_KEY, next);
  const q = new URLSearchParams(location.search);
  if (next === DEFAULT_PATH) q.delete('p'); else q.set('p', next);
  const search = q.toString();
  history.replaceState(null, '', `${location.pathname}${search ? `?${search}` : ''}${location.hash}`);
  stats = loadLast(next);
  fetchedLocal = 0;
  paint();
  void refresh(true);
}

function paint(note = '') {
  if (stats) root.innerHTML = render(stats, note, path);
  else root.innerHTML = renderMessage('pulse', note || 'loading…', path);
  document.getElementById('refresh')?.addEventListener('click', () => void refresh(true));
  root.querySelectorAll<HTMLButtonElement>('[data-path]').forEach((b) =>
    b.addEventListener('click', () => { const p = b.dataset.path ?? null; if (isPathKey(p)) choose(p); }));
}

async function refresh(force = false): Promise<void> {
  if (inflight) return inflight;
  if (!force && Date.now() - fetchedLocal < STALE_MS) return;
  const k = token();
  if (!k) {
    root.innerHTML = renderMessage('no token', 'open this page once with ?k=<token> in the URL, then add it to the home screen from that address.');
    return;
  }
  const want = path;
  inflight = (async () => {
    try {
      const res = await fetch(`${API}?path=${encodeURIComponent(want)}`, {
        headers: { authorization: `Bearer ${k}` }, cache: 'no-store',
      });
      const body = await res.json().catch(() => ({}));
      if (want !== path) return; // the picker moved on while this was in flight
      if (!res.ok) {
        const why = typeof body?.error === 'string' ? body.error : `${res.status} ${res.statusText}`;
        if (stats) paint(`refresh failed: ${why}`);
        else root.innerHTML = renderMessage(res.status === 401 ? 'token rejected' : 'no data', why, path);
        return;
      }
      stats = body as Stats;
      fetchedLocal = Date.now();
      store.set(lastKey(want), JSON.stringify(stats));
      paint();
    } catch (e) {
      if (want !== path) return;
      const why = e instanceof Error ? e.message : String(e);
      if (stats) paint(`offline: ${why}`);
      else root.innerHTML = renderMessage('offline', why, path);
    } finally {
      inflight = null;
      if (want !== path) void refresh(true); // fetch the filter that is showing now
    }
  })();
  return inflight;
}

// First paint from the last answer, so the installed app opens on numbers,
// then the network replaces them.
stats = loadLast(path);
if (stats) paint();
void refresh(true);

setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, REFRESH_MS);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refresh(); });
window.addEventListener('focus', () => void refresh());
window.addEventListener('pageshow', () => void refresh());
setInterval(() => {
  const el = document.getElementById('ago');
  if (el && stats) el.textContent = ago(stats.fetchedAt);
}, 15 * 1000);
