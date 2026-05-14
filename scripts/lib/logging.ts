// Spike-script logging. Two layers:
//
//   1. `log` / `logWarn` / `logError` / `logDebug` — freeform stdout helpers
//      for the script's own narrative output ("--- GetWeek(from: ...) ---").
//      These keep printf-style ergonomics that the production typed-event
//      logger does not.
//
//   2. `captureOpsLogger` — an adapter satisfying the production `Logger`
//      interface (LogEvent + structured data), routed to the same prefixed
//      stdout/stderr. ForkableClient takes one of these; spike scripts pass
//      this adapter so the [capture-ops] prefix is consistent.

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
