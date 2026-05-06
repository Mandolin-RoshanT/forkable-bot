import { describe, expect, test } from 'bun:test';

import { type RunLogRow, buildRows, toCsv } from '../../src/core/run-log.ts';
import type { WeekResult } from '../../src/models.ts';

const RUN_AT = '2026-05-08T23:00:00.000Z';

const fullWeek: WeekResult = {
  from: '2026-05-04',
  days: [
    { kind: 'skipped-locked', date: '2026-05-04' },
    {
      kind: 'kept-default',
      date: '2026-05-05',
      current: { venue: 'Sumac', name: 'Chicken Salad', price: 18.5 },
      bucket: 'green',
      reason: 'default already in green bucket',
    },
    {
      kind: 'swapped',
      date: '2026-05-06',
      from: { venue: 'Leleka', name: 'Chicken Dumplings', price: 19.35 },
      to: { venue: 'Palm House', name: 'Black Bean Plantain Wrap', price: 14.0 },
      bucket: 'green',
      reasoning: 'lean protein with vegetables',
    },
    {
      kind: 'no-default',
      date: '2026-05-07',
      picked: { venue: 'SOMA', name: 'Roasted Salad', price: 15.0 },
      reason: 'no current piece on the day',
    },
    { kind: 'failed', date: '2026-05-08', reason: 'transient error' },
  ],
};

describe('buildRows', () => {
  test('produces one row per day with stable column shape', () => {
    const rows = buildRows(RUN_AT, 'pick', fullWeek);
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.runAt).toBe(RUN_AT);
      expect(row.mode).toBe('pick');
    }
  });

  test('locked day → kind=LOCKED with empty fields', () => {
    const [locked] = buildRows(RUN_AT, 'pick', fullWeek);
    expect(locked).toMatchObject({
      kind: 'LOCKED',
      date: '2026-05-04',
      fromVenue: '',
      toVenue: '',
      bucket: '',
      summary: '',
    });
  });

  test('kept-default row carries the current meal as "from", empty "to"', () => {
    const [, kept] = buildRows(RUN_AT, 'pick', fullWeek);
    expect(kept).toMatchObject({
      kind: 'KEEP',
      date: '2026-05-05',
      fromVenue: 'Sumac',
      fromMeal: 'Chicken Salad',
      toVenue: '',
      toMeal: '',
      bucket: 'green',
      summary: 'default already in green bucket',
    });
  });

  test('swap row has both from and to + bucket + reasoning', () => {
    const [, , swap] = buildRows(RUN_AT, 'pick', fullWeek);
    expect(swap).toMatchObject({
      kind: 'SWAP',
      fromVenue: 'Leleka',
      fromMeal: 'Chicken Dumplings',
      toVenue: 'Palm House',
      toMeal: 'Black Bean Plantain Wrap',
      bucket: 'green',
      summary: 'lean protein with vegetables',
    });
  });

  test('no-default row has the picked meal in the "to" columns', () => {
    const [, , , noDef] = buildRows(RUN_AT, 'pick', fullWeek);
    expect(noDef).toMatchObject({
      kind: 'NO-DEFAULT',
      fromVenue: '',
      toVenue: 'SOMA',
      toMeal: 'Roasted Salad',
    });
  });

  test('failed row carries the reason as summary', () => {
    const [, , , , failed] = buildRows(RUN_AT, 'pick', fullWeek);
    expect(failed).toMatchObject({
      kind: 'FAILED',
      summary: 'transient error',
    });
  });

  test('mode column reflects dry-run vs pick', () => {
    const dryRows = buildRows(RUN_AT, 'dry-run', fullWeek);
    expect(dryRows.every((r) => r.mode === 'dry-run')).toBe(true);
  });
});

describe('toCsv', () => {
  test('emits a header on the first call (includeHeader: true)', () => {
    const csv = toCsv([], { includeHeader: true });
    expect(csv).toBe('');
  });

  test('first column is runAt, last is summary', () => {
    const rows = buildRows(RUN_AT, 'pick', fullWeek);
    const csv = toCsv(rows, { includeHeader: true });
    const [header, firstRow] = csv.split('\n');
    expect(header?.startsWith('runAt,')).toBe(true);
    expect(header?.endsWith(',summary')).toBe(true);
    expect(firstRow?.startsWith(RUN_AT)).toBe(true);
  });

  test('escapes commas, quotes, and newlines in cells', () => {
    const tricky: RunLogRow[] = [
      {
        runAt: RUN_AT,
        mode: 'pick',
        date: '2026-05-06',
        kind: 'SWAP',
        fromVenue: "Schlok's, Bagels & Lox",
        fromMeal: 'Lox "Special"',
        toVenue: 'Plain',
        toMeal: 'Plain bagel\nnewline',
        bucket: 'green',
        summary: 'no quoting issues, just protein',
      },
    ];
    const csv = toCsv(tricky, { includeHeader: false });
    // Comma in venue → wrapped in quotes
    expect(csv).toContain('"Schlok\'s, Bagels & Lox"');
    // Internal double-quotes doubled
    expect(csv).toContain('"Lox ""Special"""');
    // Newline in cell → wrapped in quotes
    expect(csv).toContain('"Plain bagel\nnewline"');
  });

  test('every line ends in a single newline', () => {
    const rows = buildRows(RUN_AT, 'pick', fullWeek);
    const csv = toCsv(rows, { includeHeader: true });
    expect(csv.endsWith('\n')).toBe(true);
    expect(csv.endsWith('\n\n')).toBe(false);
  });

  test('omits the header when includeHeader is false', () => {
    const rows = buildRows(RUN_AT, 'pick', fullWeek);
    const csv = toCsv(rows, { includeHeader: false });
    expect(csv.startsWith('runAt')).toBe(false);
    expect(csv.startsWith(RUN_AT)).toBe(true);
  });
});
