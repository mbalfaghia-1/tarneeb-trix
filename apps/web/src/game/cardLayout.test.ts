import { describe, it, expect } from 'vitest';
import { handLayout, tableauLayout, stripFor, tableauLead } from './cardLayout';

describe('Jack anchor for empty and played suits', () => {
  it('places every empty suit at rank 11, three slots below the Ace in columns', () => {
    expect(tableauLead(undefined, false)).toBe(3);
    for (let high = 11; high <= 14; high++) {
      expect(tableauLead(high, false) + high - 11).toBe(3);
    }
  });
  it('places every empty suit at rank 11, nine slots right of rank 2 in sideways rows', () => {
    expect(tableauLead(undefined, true)).toBe(9);
    for (let low = 2; low <= 11; low++) {
      expect(tableauLead(low, true) + 11 - low).toBe(9);
    }
  });
});

describe('fixed card layout throughout play', () => {
  it('keeps hand card size and overlap identical from thirteen cards down to one', () => {
    for (const available of [292, 362, 740, 1202]) {
      const full = handLayout(72, available, 13);
      expect(72 + 12 * (72 + full.offset)).toBeLessThanOrEqual(available + 0.001);
      for (let count = 1; count <= 13; count++) expect(handLayout(72, available, count)).toEqual(full);
    }
  });
  it('keeps tableau layout identical from one rank to thirteen', () => {
    for (const height of [140, 180, 330, 496]) {
      const first = tableauLayout(height, 520, 1);
      for (let count = 1; count <= 13; count++) expect(tableauLayout(height, 520, count)).toEqual(first);
    }
  });
  it('fits a full Trix run without scrolling, even on small phones', () => {
    const sizes: [number, number][] = [[140, 560], [180, 600], [230, 340], [330, 520], [496, 700]];
    for (const [h, w] of sizes) {
      const l = tableauLayout(h, w, 13);
      if (l.mode === 'columns') expect(l.height + 12 * l.step).toBeLessThanOrEqual(h + 0.001);
      else if (l.mode === 'stack') {
        expect(l.height + 3 * (l as { rowStep: number }).rowStep).toBeLessThanOrEqual(h + 0.001);
        expect(l.width + 12 * l.step).toBeLessThanOrEqual(w + 0.001);
      } else {
        expect(2 * l.height + 10).toBeLessThanOrEqual(h + 0.001);
        expect(2 * (l.width + 12 * l.step) + 10).toBeLessThanOrEqual(w + 0.001);
      }
      expect(l.step).toBeGreaterThanOrEqual(Math.min(stripFor(l.width), l.width * 0.3));
    }
  });
});
