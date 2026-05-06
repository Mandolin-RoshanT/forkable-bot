import { describe, expect, test } from 'bun:test';

import { type TiebreakCandidate, breakTie } from '../../src/core/tiebreak.ts';

function c(overrides: Partial<TiebreakCandidate>): TiebreakCandidate {
  return {
    menuId: 1,
    itemId: 1,
    venue: 'Venue',
    name: 'Item',
    price: 15,
    bucket: 'green',
    reasoning: 'ok',
    ...overrides,
  };
}

describe('breakTie', () => {
  test('throws on empty candidates', () => {
    expect(() => breakTie([], [])).toThrow();
  });

  test('returns the only candidate when there is exactly one', () => {
    const only = c({ name: 'Only' });
    expect(breakTie([only], [])).toBe(only);
  });

  test('prefers lower price', () => {
    const cheap = c({ name: 'Cheap', price: 12 });
    const pricey = c({ name: 'Pricey', price: 18 });
    expect(breakTie([pricey, cheap], []).name).toBe('Cheap');
  });

  test('on price tie, prefers a venue not yet picked this week', () => {
    const fresh = c({ name: 'Fresh', venue: 'New Venue', price: 16 });
    const stale = c({ name: 'Stale', venue: 'Used Venue', price: 16 });
    const winner = breakTie([stale, fresh], [{ venue: 'Used Venue' }]);
    expect(winner.name).toBe('Fresh');
  });

  test('on price + venue tie, falls back to first in input order', () => {
    const a = c({ name: 'A', venue: 'V1', price: 16 });
    const b = c({ name: 'B', venue: 'V2', price: 16 });
    expect(breakTie([a, b], []).name).toBe('A');
    expect(breakTie([b, a], []).name).toBe('B');
  });

  test('null prices treated as last (highest)', () => {
    const nullPrice = c({ name: 'Free?', price: null });
    const real = c({ name: 'Real', price: 18 });
    expect(breakTie([nullPrice, real], []).name).toBe('Real');
  });
});
