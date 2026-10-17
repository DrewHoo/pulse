import { PATHS, type PathKey } from '../worker/shape';
import type { Row, ShareRow, Stats } from './stats';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const fmt = (n: number) => n.toLocaleString('en-US');

const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '±0');

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

// Yesterday as ghost bars behind today's solid ones, one slot per hour, the
// current hour in the accent color. Both scale to the larger day's peak.
function bars(s: Stats): string {
  const W = 24, H = 48, gap = 1.5;
  const peak = Math.max(1, ...s.hours.yesterday, ...s.hours.today.map((n) => n ?? 0));
  const y = (n: number) => H - (n / peak) * H;
  const rects = Array.from({ length: 24 }, (_, h) => {
    const x = h * W + gap;
    const ghost = s.hours.yesterday[h] ?? 0;
    const today = s.hours.today[h] ?? null;
    const g = `<rect class="ghost" x="${x}" y="${y(ghost)}" width="${W - gap * 2}" height="${H - y(ghost)}"/>`;
    const t = today === null ? '' :
      `<rect class="${h === s.hour ? 'now' : 'today'}" x="${x}" y="${y(today)}" width="${W - gap * 2}" height="${Math.max(today > 0 ? 1 : 0, H - y(today))}"/>`;
    return g + t;
  }).join('');
  const ticks = [0, 6, 12, 18].map((h) =>
    `<text x="${h * W + gap}" y="${H + 11}">${hourLabel(h)}</text>`).join('');
  return `<svg class="bars" viewBox="0 0 ${24 * W} ${H + 14}" preserveAspectRatio="none" aria-label="views by hour, today over yesterday">
    ${rects}${ticks}
    <text class="peak" x="${24 * W - gap}" y="9" text-anchor="end">${fmt(peak)}</text>
  </svg>`;
}

function days(s: Stats): string {
  const peak = Math.max(1, ...s.days.map((d) => d.n));
  const letter = (date: string) => 'SMTWTFS'[new Date(`${date}T12:00:00Z`).getUTCDay()];
  return `<div class="days">${s.days.map((d, i) => `
    <div class="day${i === s.days.length - 1 ? ' is-today' : ''}">
      <b>${fmt(d.n)}</b>
      <i style="height:${Math.round((d.n / peak) * 100)}%" title="${fmt(d.visitors)} visitors"></i>
      <span>${letter(d.date)}</span>
    </div>`).join('')}</div>`;
}

function list(title: string, rows: Row[]): string {
  const peak = Math.max(1, ...rows.map((r) => r.today));
  const body = rows.length === 0 ? `<div class="empty">nothing this week</div>` : rows.map((r) => `
    <div class="row" title="${esc(r.name)}">
      <span class="name"><i style="width:${Math.round((r.today / peak) * 100)}%"></i>${esc(r.name)}</span>
      <span class="n">${fmt(r.today)}</span>
      <span class="v">${fmt(r.visitors)}</span>
      <span class="w">${fmt(r.week)}</span>
    </div>`).join('');
  return `<section class="list">
    <header><h2>${title}</h2><span class="n">views</span><span class="v">vis</span><span class="w">7d</span></header>
    ${body}
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

// The path filter, a row of buttons under the header; main.ts wires the clicks.
function picker(current: PathKey | undefined): string {
  if (!current) return '';
  return `<nav class="paths" aria-label="pages">${PATHS.map((p) =>
    `<button type="button" data-path="${p.key}" class="${p.key === current ? 'on' : ''}" aria-pressed="${p.key === current}">${esc(p.label)}</button>`,
  ).join('')}</nav>`;
}

export function render(s: Stats, note = '', path: PathKey = s.path): string {
  const elapsed = Math.max(1, s.hour * 60 + s.minute) / 60;
  const perHour = Math.round(s.totals.today / elapsed);
  const delta = s.totals.today - s.totals.yesterdayToHour;
  return `
  <header class="top" id="refresh" role="button" tabindex="0" aria-label="refresh">
    <h1>drewhoover.com</h1>
    <span class="asof">as of ${clock(s.hour, s.minute)} · <span id="ago">${ago(s.fetchedAt)}</span></span>
  </header>
  ${picker(path)}
  ${note ? `<p class="note">${esc(note)}</p>` : ''}
  <section class="hero">
    <div class="stat big"><b>${fmt(s.totals.thisHour)}</b><span>this hour <em>${s.minute}m in · ${fmt(s.totals.thisHourVisitors)} vis</em></span></div>
    <div class="stat"><b>${fmt(s.totals.lastHour)}</b><span>last hour</span></div>
    <div class="stat"><b>${fmt(perHour)}</b><span>per hr today</span></div>
  </section>
  ${bars(s)}
  <section class="strip">
    <div class="stat"><b>${fmt(s.totals.today)}</b><span>today <em>${fmt(s.totals.todayVisitors)} vis</em></span></div>
    <div class="stat"><b class="${delta < 0 ? 'down' : 'up'}">${signed(delta)}</b><span>vs yday ${esc(pct(s.totals.today, s.totals.yesterdayToHour))}</span></div>
    <div class="stat"><b>${fmt(s.totals.yesterday)}</b><span>yday <em>${fmt(s.totals.yesterdayVisitors)} vis</em></span></div>
    <div class="stat"><b>${fmt(s.totals.week)}</b><span>7 days</span></div>
  </section>
  ${days(s)}
  <div class="lists">
    ${list('Referrers', s.referrers)}
    ${list('Pages', s.pages)}
    ${shares(s.shares ?? [])}
  </div>`;
}

export function renderMessage(title: string, body: string, path?: PathKey): string {
  return `
  <header class="top" id="refresh" role="button" tabindex="0" aria-label="refresh">
    <h1>drewhoover.com</h1><span class="asof">pulse</span>
  </header>
  ${picker(path)}
  <section class="message"><h2>${esc(title)}</h2><p>${esc(body)}</p></section>`;
}
