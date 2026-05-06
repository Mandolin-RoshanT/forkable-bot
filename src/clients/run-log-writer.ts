// CsvRunLogWriter: appends RunLogRow[] to a CSV file. Writes the header on
// first write; appends without header thereafter.

import { existsSync } from 'node:fs';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { type RunLogRow, toCsv } from '../core/run-log.ts';
import type { Logger } from '../logger.ts';

export class CsvRunLogWriter {
  constructor(
    private readonly path: string,
    private readonly logger: Logger,
  ) {}

  async append(rows: RunLogRow[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    await mkdir(dirname(this.path), { recursive: true });
    const fileExists = existsSync(this.path);
    const content = toCsv(rows, { includeHeader: !fileExists });
    if (fileExists) {
      await appendFile(this.path, content);
    } else {
      await writeFile(this.path, content);
    }
    this.logger.info(`logged ${rows.length} row(s) → ${this.path}`);
  }
}
