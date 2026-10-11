import './styles.css';
import { ago, render, renderMessage } from './render';
import type { Stats } from './stats';

// The page is a static shell on GitHub Pages. Everything it shows comes from
// the worker at ./api/stats, gated by a bearer token. The token arrives once
// in the URL (?k=…), stays there so an iOS "Add to Home Screen" bookmark keeps
// it (the installed app gets its own storage, separate from Safari's), and is
// mirrored to localStorage as a fallback for a bookmark that lost its query.

const API = `${import.meta.env.BASE_URL}api/stats`;
const TOKEN_KEY = 'pulse.token';
const LAST_KEY = 'pulse.last';
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

function paint(note = '') {
  if (stats) root.innerHTML = render(stats, note);
  else root.innerHTML = renderMessage('pulse', note || 'loading…');
  document.getElementById('refresh')?.addEventListener('click', () => void refresh(true));
}

async function refresh(force = false): Promise<void> {
  if (inflight) return inflight;
  if (!force && Date.now() - fetchedLocal < STALE_MS) return;
  const k = token();
  if (!k) {
    root.innerHTML = renderMessage('no token', 'open this page once with ?k=<token> in the URL, then add it to the home screen from that address.');
    return;
  }
  inflight = (async () => {
    try {
      const res = await fetch(API, { headers: { authorization: `Bearer ${k}` }, cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const why = typeof body?.error === 'string' ? body.error : `${res.status} ${res.statusText}`;
        if (stats) paint(`refresh failed: ${why}`);
        else root.innerHTML = renderMessage(res.status === 401 ? 'token rejected' : 'no data', why);
        return;
      }
      stats = body as Stats;
      fetchedLocal = Date.now();
      store.set(LAST_KEY, JSON.stringify(stats));
      paint();
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      if (stats) paint(`offline: ${why}`);
      else root.innerHTML = renderMessage('offline', why);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

// First paint from the last answer, so the installed app opens on numbers,
// then the network replaces them.
const last = store.get(LAST_KEY);
if (last) {
  try { stats = JSON.parse(last) as Stats; paint(); } catch { /* ignore a bad cache */ }
}
void refresh(true);

setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, REFRESH_MS);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refresh(); });
window.addEventListener('focus', () => void refresh());
window.addEventListener('pageshow', () => void refresh());
setInterval(() => {
  const el = document.getElementById('ago');
  if (el && stats) el.textContent = ago(stats.fetchedAt);
}, 15 * 1000);
