// The page's view of the worker's answer. Kept in step with worker/shape.ts by
// re-exporting its types, so a shape change fails typecheck on both sides.
export type { Stats, Row, ShareRow, RedditRow } from '../worker/shape';
export type { Measures, MeasureWindow, Tally } from '../worker/measures';
