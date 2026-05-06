import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CsvRunLogWriter } from '../../src/clients/run-log-writer.ts';
import type { RunLogRow } from '../../src/core/run-log.ts';
import type { Logger } from '../../src/logger.ts';

const silentLogger: Logger = { info: () => {}, error: () => {}, debug: () => {} };

const sampleRow = (overrides: Partial<RunLogRow> = {}): RunLogRow => ({
  runAt: '2026-05-08T23:00:00.000Z',
  mode: 'pick',
  date: '2026-05-11',
  kind: 'SWAP',
  fromVenue: 'A',
  fromMeal: 'A1',
  toVenue: 'B',
  toMeal: 'B1',
  bucket: 'green',
  summary: 'reason',
  ...overrides,
});

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'run-log-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('CsvRunLogWriter', () => {
  test('creates the file with a header on first append', async () => {
    const path = join(dir, 'history.csv');
    const writer = new CsvRunLogWriter(path, silentLogger);

    await writer.append([sampleRow({ date: '2026-05-11' })]);

    expect(existsSync(path)).toBe(true);
    const contents = await readFile(path, 'utf8');
    const lines = contents.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('runAt');
    expect(lines[0]).toContain('summary');
    expect(lines[1]).toContain('2026-05-11');
  });

  test('appends without re-emitting the header on subsequent calls', async () => {
    const path = join(dir, 'history.csv');
    const writer = new CsvRunLogWriter(path, silentLogger);

    await writer.append([sampleRow({ date: '2026-05-11' })]);
    await writer.append([sampleRow({ date: '2026-05-12' }), sampleRow({ date: '2026-05-13' })]);

    const contents = await readFile(path, 'utf8');
    const headerCount = contents.split('\n').filter((l) => l.startsWith('runAt')).length;
    expect(headerCount).toBe(1);

    expect(contents).toContain('2026-05-11');
    expect(contents).toContain('2026-05-12');
    expect(contents).toContain('2026-05-13');
  });

  test('creates parent directories as needed', async () => {
    const path = join(dir, 'nested', 'subdir', 'history.csv');
    const writer = new CsvRunLogWriter(path, silentLogger);
    await writer.append([sampleRow()]);
    expect(existsSync(path)).toBe(true);
  });

  test('no-ops on an empty rows array', async () => {
    const path = join(dir, 'history.csv');
    const writer = new CsvRunLogWriter(path, silentLogger);
    await writer.append([]);
    expect(existsSync(path)).toBe(false);
  });
});
