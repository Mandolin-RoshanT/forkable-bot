// Settings-driven logger. Secrets known at construction time are scrubbed
// from every log line before output, so an accidental include of the password
// or an API key in a message can't leak to stdout.

import type { Settings } from './config.ts';

export type Logger = {
  info(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
};

const PREFIX = '[forkable-bot]';

export function createLogger(settings: Settings): Logger {
  const secrets = [
    settings.forkable.password,
    settings.scorer.apiKey,
    settings.resend.apiKey,
  ].filter((s) => s.length >= 4);

  function scrub(msg: string): string {
    let out = msg;
    for (const s of secrets) {
      if (out.includes(s)) {
        out = out.replaceAll(s, '<redacted>');
      }
    }
    return out;
  }

  return {
    info(msg) {
      console.log(`${PREFIX} ${scrub(msg)}`);
    },
    error(msg) {
      console.error(`${PREFIX} ${scrub(msg)}`);
    },
    debug(msg) {
      if (settings.debug) {
        console.log(`${PREFIX} ${scrub(msg)}`);
      }
    },
  };
}
