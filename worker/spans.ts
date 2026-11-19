// Its own module so the page can read the spans without the worker's code.

/**
 * The two windows the visitors screen offers. Each starts at a local
 * midnight, today's or six days before it, and its arrivals are compared with
 * the same hours `comparedDaysBack` earlier. An arrival is new when the
 * `newAfterDays` before the window hold none like it.
 */
export const SPANS = {
  today: { days: 1, comparedDaysBack: 1, newAfterDays: 2 },
  week: { days: 7, comparedDaysBack: 7, newAfterDays: 7 },
} as const;
export type Span = keyof typeof SPANS;
export const isSpan = (s: unknown): s is Span => typeof s === 'string' && Object.hasOwn(SPANS, s);
