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
  test('writes a fresh file with header + rows', async () => {
    const path = join(dir, '2026-05-11.csv');
    const writer = new CsvRunLogWriter(path, silentLogger);

    await writer.write([sampleRow({ date: '2026-05-11' })]);

    expect(existsSync(path)).toBe(true);
    const contents = await readFile(path, 'utf8');
    const lines = contents.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('runAt');
    expect(lines[1]).toContain('2026-05-11');
  });

  test('overwrites previous contents on subsequent write', async () => {
    const path = join(dir, '2026-05-11.csv');
    const writer = new CsvRunLogWriter(path, silentLogger);

    await writer.write([sampleRow({ date: '2026-05-11', summary: 'first' })]);
    await writer.write([sampleRow({ date: '2026-05-12', summary: 'second' })]);

    const contents = await readFile(path, 'utf8');
    expect(contents).not.toContain('first');
    expect(contents).toContain('second');
    // Still exactly one header.
    const headerCount = contents.split('\n').filter((l) => l.startsWith('runAt')).length;
    expect(headerCount).toBe(1);
  });

  test('creates parent directories as needed', async () => {
    const path = join(dir, 'nested', 'subdir', '2026-05-11.csv');
    const writer = new CsvRunLogWriter(path, silentLogger);
    await writer.write([sampleRow()]);
    expect(existsSync(path)).toBe(true);
  });

  test('no-ops on an empty rows array', async () => {
    const path = join(dir, '2026-05-11.csv');
    const writer = new CsvRunLogWriter(path, silentLogger);
    await writer.write([]);
    expect(existsSync(path)).toBe(false);
  });
});
