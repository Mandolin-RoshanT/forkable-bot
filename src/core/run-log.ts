// Per-run history rows. Pure: builds rows from a WeekResult and serializes
// them to RFC-4180-style CSV. The actual file IO is in the writer (boundary).

import { type DayResult, type WeekResult, assertNever } from '../models.ts';

export type RunMode = 'dry-run' | 'pick';

export type RunLogRow = {
  runAt: string; // ISO 8601
  mode: RunMode;
  date: string; // YYYY-MM-DD
  kind: 'SWAP' | 'KEEP' | 'NO-DEFAULT' | 'LOCKED' | 'FAILED';
  fromVenue: string;
  fromMeal: string;
  toVenue: string;
  toMeal: string;
  bucket: string; // 'green' | 'yellow' | 'red' | ''
  summary: string;
};

const HEADER: readonly (keyof RunLogRow)[] = [
  'runAt',
  'mode',
  'date',
  'kind',
  'fromVenue',
  'fromMeal',
  'toVenue',
  'toMeal',
  'bucket',
  'summary',
];

// Default values for the variable-per-kind fields. Each `buildRow` case
// spreads these and overrides only what's relevant, so the per-kind diff
// is what jumps out instead of a wall of empty strings.
const EMPTY_FIELDS = {
  fromVenue: '',
  fromMeal: '',
  toVenue: '',
  toMeal: '',
  bucket: '',
  summary: '',
} as const;

export function buildRows(runAt: string, mode: RunMode, week: WeekResult): RunLogRow[] {
  return week.days.map((d) => buildRow(runAt, mode, d));
}

function buildRow(runAt: string, mode: RunMode, day: DayResult): RunLogRow {
  const base = { runAt, mode, date: day.date, ...EMPTY_FIELDS };
  switch (day.kind) {
    case 'swapped':
      return {
        ...base,
        kind: 'SWAP',
        fromVenue: day.from.venue,
        fromMeal: day.from.name,
        toVenue: day.to.venue,
        toMeal: day.to.name,
        bucket: day.bucket,
        summary: day.reasoning,
      };
    case 'kept-default':
      return {
        ...base,
        kind: 'KEEP',
        fromVenue: day.current.venue,
        fromMeal: day.current.name,
        bucket: day.bucket,
        summary: day.reason,
      };
    case 'no-default':
      return {
        ...base,
        kind: 'NO-DEFAULT',
        toVenue: day.picked?.venue ?? '',
        toMeal: day.picked?.name ?? '',
        summary: day.reason,
      };
    case 'skipped-locked':
      return { ...base, kind: 'LOCKED' };
    case 'failed':
      return { ...base, kind: 'FAILED', summary: day.reason };
    default:
      return assertNever(day);
  }
}

export function toCsv(rows: RunLogRow[]): string {
  if (rows.length === 0) {
    return '';
  }
  const lines: string[] = [HEADER.join(',')];
  for (const row of rows) {
    lines.push(HEADER.map((col) => escapeCell(row[col])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

// RFC-4180-style escape: wrap in quotes if the cell contains a comma,
// quote, or newline; double internal quotes.
function escapeCell(value: string): string {
  if (value === '') {
    return '';
  }
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}
