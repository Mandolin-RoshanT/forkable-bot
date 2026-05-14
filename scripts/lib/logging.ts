// Spike-script logging. Freeform `log`/`logWarn`/`logError`/`logDebug` for the
// script's own narrative output, plus `captureOpsLogger` — an adapter
// satisfying the production `Logger` interface so ForkableClient can be
// passed into spike scripts with a consistent [capture-ops] prefix.

import type { LogData, Logger } from '../../src/logger.ts';

export { redactCookie, redactEmail } from '../../src/lib/redact.ts';

const PREFIX = '[capture-ops]';

export function log(msg: string): void {
  console.log(`${PREFIX} ${msg}`);
}

export function logWarn(msg: string): void {
  console.log(`${PREFIX} WARN ${msg}`);
}

export function logError(msg: string): void {
  console.error(`${PREFIX} ${msg}`);
}

export function logDebug(msg: string): void {
  if (process.env.DEBUG === '1') {
    console.log(`${PREFIX} ${msg}`);
  }
}

function format(event: string, data: LogData | undefined): string {
  if (!data || Object.keys(data).length === 0) return event;
  return `${event} ${JSON.stringify(data)}`;
}

export const captureOpsLogger: Logger = {
  info: (event, data) => log(format(event, data)),
  warn: (event, data) => logWarn(format(event, data)),
  error: (event, data) => logError(format(event, data)),
  debug: (event, data) => logDebug(format(event, data)),
};
