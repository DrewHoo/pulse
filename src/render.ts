import { PATHS, siteName, type PathKey } from '../worker/shape';
import type { RedditRow, Row, ShareRow, Stats } from './stats';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const fmt = (n: number) => n.toLocaleString('en-US');

const pct = (now: number, then: number) => {
  if (then === 0) return now === 0 ? '' : 'new';
  const p = Math.round(((now - then) / then) * 100);
  return p > 0 ? `+${p}%` : p < 0 ? `−${-p}%` : '0%';
};

const clock = (h: number, m: number) =>
  `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h < 12 ? 'a' : 'p'}`;

const hourLabel = (h: number) => (h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`);

export function ago(fetchedAt: string, now: Date = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - new Date(fetchedAt).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

// Visitors by hour: yesterday as ghost bars behind today's solid ones, the
// current hour in the accent color. Both scale to the larger day's peak.
function bars(s: Stats): string {
  const W = 24, H = 48, gap = 1.5;
  const yesterdayHours = s.hours.yesterdayVisitors;
  const todayHours = s.hours.todayVisitors;
  const peak = Math.max(1, ...yesterdayHours, ...todayHours.map((n) => n ?? 0));
  const y = (n: number) => H - (n / peak) * H;
  const rects = Array.from({ length: 24 }, (_, h) => {
    const x = h * W + gap;
    const ghost = yesterdayHours[h] ?? 0;
    const today = todayHours[h] ?? null;
    const g = `<rect class="ghost" x="${x}" y="${y(ghost)}" width="${W - gap * 2}" height="${H - y(ghost)}"/>`;
    const t = today === null ? '' :
      `<rect class="${h === s.hour ? 'now' : 'today'}" x="${x}" y="${y(today)}" width="${W - gap * 2}" height="${Math.max(today > 0 ? 1 : 0, H - y(today))}"/>`;
    return g + t;
  }).join('');
  const ticks = [0, 6, 12, 18].map((h) =>
    `<text x="${h * W + gap}" y="${H + 11}">${hourLabel(h)}</text>`).join('');
  return `<svg class="bars" viewBox="0 0 ${24 * W} ${H + 14}" preserveAspectRatio="none" aria-label="visitors by hour, today over yesterday">
    ${rects}${ticks}
    <text class="peak" x="${24 * W - gap}" y="9" text-anchor="end">${fmt(peak)}</text>
  </svg>`;
}

function days(s: Stats): string {
  const peak = Math.max(1, ...s.days.map((d) => d.visitors));
  const letter = (date: string) => 'SMTWTFS'[new Date(`${date}T12:00:00Z`).getUTCDay()];
  return `<div class="days">${s.days.map((d, i) => `
    <div class="day${i === s.days.length - 1 ? ' is-today' : ''}">
      <b>${fmt(d.visitors)}</b>
      <i style="height:${Math.round((d.visitors / peak) * 100)}%" title="${fmt(d.n)} views"></i>
      <span>${letter(d.date)}</span>
    </div>`).join('')}</div>`;
}

// Today's visitors lead each row, then today's views and the week's views
// (visitors don't sum across days, so the week stays in views).
function list(title: string, rows: Row[], empty = 'nothing this week', foot = ''): string {
  const peak = Math.max(1, ...rows.map((r) => r.visitors));
  const body = rows.length === 0 ? `<div class="empty">${esc(empty)}</div>` : rows.map((r) => `
    <div class="row" title="${esc(r.name)}">
      <span class="name"><i style="width:${Math.round((r.visitors / peak) * 100)}%"></i>${esc(r.name)}</span>
      <span class="n">${fmt(r.visitors)}</span>
      <span class="v">${fmt(r.today)}</span>
      <span class="w">${fmt(r.week)}</span>
    </div>`).join('');
  return `<section class="list">
    <header><h2>${title}</h2><span class="n">vis</span><span class="v">views</span><span class="w">7d views</span></header>
    ${body}
    ${foot ? `<p class="foot">${esc(foot)}</p>` : ''}
  </section>`;
}

// Link previews: one row per app a Streak King link was pasted into. No
// visitors column, since a preview is a bot's fetch, not a person.
function shares(rows: ShareRow[]): string {
  const peak = Math.max(1, ...rows.map((r) => r.week));
  const body = rows.length === 0 ? `<div class="empty">no links shared this week</div>` : rows.map((r) => `
    <div class="row">
      <span class="name"><i style="width:${Math.round((r.week / peak) * 100)}%"></i>${esc(r.name)}</span>
      <span class="n">${fmt(r.today)}</span>
      <span class="v"></span>
      <span class="w">${fmt(r.week)}</span>
    </div>`).join('');
  return `<section class="list">
    <header><h2>Shared in</h2><span class="n">today</span><span class="v"></span><span class="w">7d</span></header>
    ${body}
    <p class="foot">Streak King link previews by app. Their clicks arrive as (direct).</p>
  </section>`;
}

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// "2026-10-17 21" as "Sat 9p", or "9p" when it is today.
function when(at: string, today: string): string {
  const [date = '', hh = '0'] = at.split(' ');
  const h = Number(hh);
  const hour = h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`;
  if (date === today) return hour;
  return `${DAY[new Date(`${date}T12:00:00Z`).getUTCDay()]} ${hour}`;
}

// A Streak King URL as its view: the path under the site and the query, with
// the commas and colons the board writes percent-encoded read back.
function viewName(url: string): string {
  let u: URL;
  try { u = new URL(url); } catch { return url; }
  const path = u.pathname.replace(/^\/cfb-streak-king/, '') || '/';
  return decodeURIComponent(`${path}${u.search}`.replace(/\+/g, ' '));
}

const isSite = (url: string) => { try { return new URL(url).hostname === 'drewhoover.com'; } catch { return false; } };

// Leads to look up on Reddit: each link Reddit fetched, with how it fetched
// it. The reddit-referred views above them are the dependable line.
function reddit(s: Stats): string {
  const r = s.reddit ?? { views: { name: 'reddit', today: 0, visitors: 0, week: 0 }, links: [] };
  const kind = (l: RedditRow) => [l.crawler ? 'link post' : '', l.text ? 'in text' : ''].filter(Boolean).join(' + ');
  const body = r.links.length === 0 ? `<div class="empty">no Reddit fetches this week</div>` : r.links.map((l) => `
    <div class="row lead" title="${esc(l.url)}">
      <span class="name">${isSite(l.url)
        ? `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(viewName(l.url))}</a>`
        : esc(viewName(l.url))}</span>
      <span class="k">${esc(kind(l))}</span>
      <span class="w">${esc(when(l.at, s.date))}</span>
    </div>`).join('');
  return `<section class="list">
    <header><h2>Reddit</h2><span class="n">vis</span><span class="v">views</span><span class="w">7d views</span></header>
    <div class="row">
      <span class="name">referred</span>
      <span class="n">${fmt(r.views.visitors)}</span>
      <span class="v">${fmt(r.views.today)}</span>
      <span class="w">${fmt(r.views.week)}</span>
    </div>
    <h3>links Reddit fetched</h3>
    ${body}
    <p class="foot">A link post's URL is fetched by Reddit's crawler (a draft can be too); a link in a post's or comment's text, &amp;amp;-escaped. Leads, not a count: look them up on Reddit.</p>
  </section>`;
}

// The path filter, a row of buttons under the header; main.ts wires the clicks.
function picker(current: PathKey | undefined): string {
  if (!current) return '';
  return `<nav class="paths" aria-label="pages">${PATHS.map((p) =>
    `<button type="button" data-path="${p.key}" class="${p.key === current ? 'on' : ''}" aria-pressed="${p.key === current}">${esc(p.label)}</button>`,
  ).join('')}</nav>`;
}

export function render(s: Stats, note = '', path: PathKey = s.path): string {
  const t = s.totals;
  // the worker served a kept copy because Mixpanel refused or failed
  if (!note && s.staleSince) note = `Mixpanel didn't answer (likely its hourly limit): numbers from ${ago(s.staleSince)}`;
  const vsYday = pct(t.todayVisitorHours, t.yesterdayVisitorHoursToHour);
  const back = s.returning;
  return `
  <header class="top" id="refresh" role="button" tabindex="0" aria-label="refresh">
    <h1>${esc(siteName(path))}</h1>
    <span class="asof">as of ${clock(s.hour, s.minute)} · <span id="ago">${ago(s.fetchedAt)}</span></span>
  </header>
  ${picker(path)}
  ${note ? `<p class="note">${esc(note)}</p>` : ''}
  <section class="hero">
    <div class="stat big"><b>${fmt(t.thisHourVisitors)}</b><span>visitors this hour <em>${s.minute}m in · ${fmt(t.thisHour)} views</em></span></div>
    <div class="stat"><b>${fmt(t.lastHourVisitors)}</b><span>last hour <em>${fmt(t.lastHour)} views</em></span></div>
    <div class="stat"><b>${back ? fmt(back.today) : '–'}</b><span>returning <em>today</em></span></div>
  </section>
  ${bars(s)}
  <section class="strip">
    <div class="stat"><b>${fmt(t.todayVisitors)}</b><span>today <em>${fmt(t.today)} views</em></span></div>
    <div class="stat"><b class="${vsYday.startsWith('−') ? 'down' : 'up'}">${esc(vsYday || '±0')}</b><span>vs yday so far</span></div>
    <div class="stat"><b>${fmt(t.yesterdayVisitors)}</b><span>yday <em>${fmt(t.yesterday)} views</em></span></div>
    <div class="stat"><b>${back ? fmt(back.weekVisitors) : fmt(t.weekVisitorsPerDay)}</b><span>${back ? '7 days' : 'per day, 7d'} <em>${fmt(t.week)} views</em></span></div>
  </section>
  ${days(s)}
  <p class="foot recur">Real users only: no bots, none of Drew's devices.</p>
  ${back ? `<p class="foot recur">${fmt(back.week)} of the week's ${fmt(back.weekVisitors)} visitors came on two or more days; ${fmt(back.today)} of today's ${fmt(t.todayVisitors)} had been here before.</p>` : ''}
  <div class="lists">
    ${list('Referrers', s.referrers)}
    ${list('AI assistants', s.ai ?? [], 'no AI referrals this week', 'By utm_source, else referrer. ChatGPT and Perplexity tag their links and send no referrer.')}
    ${path === 'puttingupnumbers' ? list('Sports', s.sports ?? [], 'nothing this week') : ''}
    ${list('Pages', s.pages)}
    ${shares(s.shares ?? [])}
    ${reddit(s)}
  </div>`;
}

export function renderMessage(title: string, body: string, path?: PathKey): string {
  return `
  <header class="top" id="refresh" role="button" tabindex="0" aria-label="refresh">
    <h1>${esc(path ? siteName(path) : 'drewhoover.com')}</h1><span class="asof">pulse</span>
  </header>
  ${picker(path)}
  <section class="message"><h2>${esc(title)}</h2><p>${esc(body)}</p></section>`;
}
