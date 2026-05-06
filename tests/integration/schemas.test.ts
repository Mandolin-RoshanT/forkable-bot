// Smoke test: real captured responses parse cleanly against our Zod schemas.
// If Forkable changes a field, this test fails before the bot's next live run.

import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

import {
  GetAlternativesResponseSchema,
  GetWeekResponseSchema,
} from '../../src/schemas/forkable.ts';

const CAPTURES = resolve(import.meta.dir, '../../scripts/captures');

describe('schema parsing — captured responses', () => {
  test('get-week.json parses against GetWeekResponseSchema', async () => {
    const raw = await Bun.file(`${CAPTURES}/get-week.json`).json();
    const parsed = GetWeekResponseSchema.parse(raw.data);

    expect(parsed.myDeliveries).toHaveLength(5);

    const editable = parsed.myDeliveries.filter((d) => !d.isReadOnly);
    expect(editable.length).toBeGreaterThanOrEqual(1);

    // Each editable day has one (and only one) order with a current piece.
    for (const day of editable) {
      const ordersWithPieces = day.orders.filter((o) => o.pieces.length > 0);
      expect(ordersWithPieces).toHaveLength(1);
      expect(day.availableMenuIds.length).toBe(day.orders.length);
    }
  });

  test('get-alternatives.json parses against GetAlternativesResponseSchema', async () => {
    const raw = await Bun.file(`${CAPTURES}/get-alternatives.json`).json();
    const parsed = GetAlternativesResponseSchema.parse(raw.data);

    expect(parsed.menus.length).toBeGreaterThan(0);
    for (const menu of parsed.menus) {
      expect(menu.venue.id).toBeGreaterThan(0);
      expect(menu.sections.length).toBeGreaterThan(0);
      for (const section of menu.sections) {
        expect(section.items.length).toBeGreaterThan(0);
      }
    }
  });
});
