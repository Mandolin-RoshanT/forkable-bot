// Settings-driven logger. Secrets known at construction time are scrubbed
// from every log line before output, so an accidental include of the password
// or an API key in a payload can't leak to stdout.
//
// Calls take a typed `LogEvent` plus an optional structured `data` payload.
// Output format: `[forkable-bot] <level> event.name {"key":"value"}` —
// `<level>` is omitted for INFO, the JSON suffix is omitted when `data`
// is empty.

import type { Settings } from './config.ts';
import type { LogEvent } from './lib/log-events.ts';

export type LogData = Record<string, unknown>;

export type Logger = {
  info(event: LogEvent, data?: LogData): void;
  warn(event: LogEvent, data?: LogData): void;
  error(event: LogEvent, data?: LogData): void;
  debug(event: LogEvent, data?: LogData): void;
};

const PREFIX = '[forkable-bot]';

export function createLogger(settings: Settings): Logger {
  const secrets = [
    settings.forkable.password,
    settings.openaiApiKey,
    settings.resend.apiKey,
  ].filter((s) => s.length >= 4);

  function scrub(line: string): string {
    let out = line;
    for (const s of secrets) {
      if (out.includes(s)) {
        out = out.replaceAll(s, '<redacted>');
      }
    }
    return out;
  }

  function format(level: string, event: LogEvent, data: LogData | undefined): string {
    const payload = data && Object.keys(data).length > 0 ? ` ${JSON.stringify(data)}` : '';
    const prefix = level === 'INFO' ? PREFIX : `${PREFIX} ${level}`;
    return scrub(`${prefix} ${event}${payload}`);
  }

  return {
    info(event, data) {
      console.log(format('INFO', event, data));
    },
    warn(event, data) {
      console.log(format('WARN', event, data));
    },
    error(event, data) {
      console.error(format('ERROR', event, data));
    },
    debug(event, data) {
      if (settings.debug) {
        console.log(format('DEBUG', event, data));
      }
    },
  };
}
