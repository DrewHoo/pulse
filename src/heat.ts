// Where a number sits among the others in its column, so a list of small
// numbers reads without comparing them one by one: the landings screen tints a
// number in its column's top or bottom quarter, and more in its top or bottom
// tenth. specs/landings.spec.md, "Tints".

/** A number's place in its column: nothing in the middle half. */
export type Heat = '' | 'most' | 'more' | 'less' | 'least';

/** A number is tinted when this share of its column is under it, or over it. */
export const QUARTER = 0.75;
export const TENTH = 0.9;
/** A column of fewer numbers than this has no top or bottom quarter to speak of. */
export const COLUMN_AT_LEAST = 4;

/**
 * Reads one number against a column of them. A number is "more" when QUARTER
 * of the column is strictly under it and "most" at TENTH, and "less" and
 * "least" the same way from the other end, so numbers that tie share a tint
 * and a column of one value has none.
 */
export function heatAmong(column: number[]): (value: number) => Heat {
  if (column.length < COLUMN_AT_LEAST) return () => '';
  const share = (is: (other: number) => boolean) => column.filter(is).length / column.length;
  return (value) => {
    const under = share((other) => other < value);
    const over = share((other) => other > value);
    if (under >= TENTH) return 'most';
    if (under >= QUARTER) return 'more';
    if (over >= TENTH) return 'least';
    if (over >= QUARTER) return 'less';
    return '';
  };
}
