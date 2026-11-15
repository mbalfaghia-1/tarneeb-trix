import { describe, it, expect } from 'vitest';
import { handLayout, tableauLayout } from './cardLayout';

describe('fixed card layout throughout play', () => {
  it('keeps hand card size and overlap identical from thirteen cards down to one', () => {
    for (const available of [292, 362, 740, 1202]) {
      const full = handLayout(72, available, 13);
      expect(72 + 12 * (72 + full.offset)).toBeLessThanOrEqual(available + 0.001);
      for (let count = 1; count <= 13; count++) {
        expect(handLayout(72, available, count)).toEqual(full);
      }
    }
  });
  it('keeps tableau card size and stacking step identical from one rank to thirteen', () => {
    for (const height of [180, 330, 496]) {
      const first = tableauLayout(height, 520, 1);
      for (let count = 1; count <= 13; count++) {
        expect(tableauLayout(height, 520, count)).toEqual(first);
      }
    }
    const full = tableauLayout(330, 520, 13);
    expect(full.height + 12 * full.step).toBeLessThanOrEqual(330.001);
  });
});
