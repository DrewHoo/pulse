import { describe, expect, it } from 'vitest';
import { heatAmong } from './heat';

describe('a number among its column', () => {
  const twenty = Array.from({ length: 20 }, (_, i) => i + 1);
  const heat = heatAmong(twenty);

  it('is most or least in the top or bottom tenth, more or less in the quarter, and nothing between', () => {
    expect([20, 19].map(heat)).toEqual(['most', 'most']);
    expect([18, 17, 16].map(heat)).toEqual(['more', 'more', 'more']);
    expect([15, 10, 6].map(heat)).toEqual(['', '', '']);
    expect([5, 4, 3].map(heat)).toEqual(['less', 'less', 'less']);
    expect([2, 1].map(heat)).toEqual(['least', 'least']);
  });

  it('gives numbers that tie the same tint, and a column of one value none', () => {
    // six landing pages with one visit each aren't the bottom quarter of ten
    const visits = [1, 1, 1, 1, 1, 1, 3, 8, 40, 200];
    expect(visits.map(heatAmong(visits))).toEqual(['', '', '', '', '', '', '', '', 'more', 'most']);
    expect([7, 7, 7, 7].map(heatAmong([7, 7, 7, 7]))).toEqual(['', '', '', '']);
  });

  it('reads a number that isn\'t in the column against it', () => {
    expect([heat(50), heat(0), heat(10.5)]).toEqual(['most', 'least', '']);
  });

  it('tints nothing in a column of fewer than four', () => {
    expect([1, 50, 100].map(heatAmong([1, 50, 100]))).toEqual(['', '', '']);
    expect([1, 2, 3, 100].map(heatAmong([1, 2, 3, 100]))).toEqual(['less', '', '', 'more']);
  });
});
