import { describe, expect, test } from 'bun:test';

import { thisWeekMonday } from '../../src/format.ts';

describe('thisWeekMonday', () => {
  test('a Monday returns itself', () => {
    expect(thisWeekMonday(new Date('2026-05-04T12:00:00Z'))).toBe('2026-05-04');
  });

  test("a Friday returns the same week's Monday", () => {
    expect(thisWeekMonday(new Date('2026-05-08T23:00:00Z'))).toBe('2026-05-04');
  });

  test("a Sunday returns the previous week's Monday (not the next)", () => {
    expect(thisWeekMonday(new Date('2026-05-10T12:00:00Z'))).toBe('2026-05-04');
  });

  test('default arg returns a Monday-shaped string', () => {
    const out = thisWeekMonday();
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Construct the date and confirm it really is a Monday.
    expect(new Date(`${out}T00:00:00Z`).getUTCDay()).toBe(1);
  });
});
