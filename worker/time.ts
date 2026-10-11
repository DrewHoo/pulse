// Mixpanel labels every bucket in the project's timezone ("2026-10-11 13:00:00"
// for an hour, "2026-10-11" for a day), so the worker reasons about "now" in
// that zone and never in UTC.

export interface LocalNow {
  date: string;   // YYYY-MM-DD
  hour: number;   // 0-23
  minute: number; // 0-59
  tz: string;
}

export function localNow(tz: string, at: Date = new Date()): LocalNow {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    tz,
  };
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export const pad2 = (n: number) => String(n).padStart(2, '0');
