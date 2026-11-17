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

/**
 * The project-local date and hour of an event's time, for a week of events:
 * the zone is read once a UTC hour, which holds for any zone whose offset is
 * whole hours.
 */
export function localHours(tz: string): (at: number) => { date: string; hour: number } {
  const HOUR_MS = 3_600_000;
  const byHour = new Map<number, { date: string; hour: number }>();
  return (at) => {
    const start = at - (at % HOUR_MS);
    let local = byHour.get(start);
    if (!local) {
      const { date, hour } = localNow(tz, new Date(start));
      local = { date, hour };
      byHour.set(start, local);
    }
    return local;
  };
}

// How far the zone's clock runs ahead of UTC at `at`, in ms (EDT: -4h).
export function offsetMs(tz: string, at: Date = new Date()): number {
  const n = localNow(tz, at);
  const [y, m, d] = n.date.split('-').map(Number) as [number, number, number];
  const local = Date.UTC(y, m - 1, d, n.hour, n.minute);
  return local - Math.floor(at.getTime() / 60_000) * 60_000;
}
