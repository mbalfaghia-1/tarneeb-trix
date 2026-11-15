import { describe, it, expect } from 'vitest';
import { handLayout, tableauLayout } from './cardLayout';

describe('fixed card dimensions throughout play', () => {
  it('keeps hand cards the same size from thirteen cards down to one', () => {
    for (const available of [292, 362, 740, 1202]) {
      for (let count = 1; count <= 13; count++) {
        const layout = handLayout(72, available, count);
        expect(layout.width).toBe(72);
        expect(layout.height).toBeCloseTo(100.8);
        expect(72 + (count - 1) * (72 + layout.offset)).toBeLessThanOrEqual(available + 0.001);
      }
    }
  });
  it('keeps tableau cards the same size from one rank to a full thirteen-rank column', () => {
    for (const height of [180, 330, 496]) {
      const first = tableauLayout(height, 520, 1);
      for (let count = 1; count <= 13; count++) {
        const layout = tableauLayout(height, 520, count);
        expect(layout.width).toBe(first.width);
        expect(layout.height).toBe(first.height);
      }
    }
    const full = tableauLayout(330, 520, 13);
    expect(full.height + 12 * full.step).toBeCloseTo(330);
  });
});