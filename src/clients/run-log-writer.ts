// CsvRunLogWriter: writes (overwrites) a fresh CSV per run. Each Friday's
// file is a self-contained snapshot of that week's picks, not a rolling
// log — see runs/<from>.csv naming in cli.ts.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { type RunLogRow, toCsv } from '../core/run-log.ts';
import type { Logger } from '../logger.ts';

export class CsvRunLogWriter {
  constructor(
    private readonly path: string,
    private readonly logger: Logger,
  ) {}

  async write(rows: RunLogRow[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, toCsv(rows));
    this.logger.info(`logged ${rows.length} row(s) → ${this.path}`);
  }
}
