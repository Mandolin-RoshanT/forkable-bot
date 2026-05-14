import { describe, expect, test } from 'bun:test';

import type { Settings } from '../../src/config.ts';
import { LOG_EVENTS } from '../../src/lib/log-events.ts';
import { createLogger } from '../../src/logger.ts';

const baseSettings: Settings = {
  forkable: { email: 'r@example.com', password: 'super-secret-pw', timeoutMs: 30_000 },
  openaiApiKey: 'sk-openai-key-12345',
  resend: {
    apiKey: 're_resend_key_67890',
    notifyTo: 'r@example.com',
    notifyFrom: 'bot@example.com',
    timeoutMs: 10_000,
  },
  debug: false,
};

function captureStdout(fn: () => void): string[] {
  const captured: string[] = [];
  const original = console.log;
  console.log = (msg: string) => captured.push(msg);
  try {
    fn();
  } finally {
    console.log = original;
  }
  return captured;
}

function captureStderr(fn: () => void): string[] {
  const captured: string[] = [];
  const original = console.error;
  console.error = (msg: string) => captured.push(msg);
  try {
    fn();
  } finally {
    console.error = original;
  }
  return captured;
}

describe('createLogger', () => {
  test('scrubs the forkable password when it appears in payload values', () => {
    const logger = createLogger(baseSettings);
    const lines = captureStdout(() => {
      logger.info(LOG_EVENTS.RUN_ACCOUNT, { context: 'login failed for super-secret-pw' });
    });
    expect(lines[0]).toContain('<redacted>');
    expect(lines[0]).not.toContain('super-secret-pw');
  });

  test('scrubs the openai key from serialized payload', () => {
    const logger = createLogger(baseSettings);
    const lines = captureStdout(() => {
      logger.info(LOG_EVENTS.RUN_MODE, { header: 'Authorization: Bearer sk-openai-key-12345' });
    });
    expect(lines[0]).not.toContain('sk-openai-key-12345');
  });

  test('emits event name with no payload suffix when data is omitted', () => {
    const logger = createLogger(baseSettings);
    const lines = captureStdout(() => {
      logger.info(LOG_EVENTS.RUN_NO_MAILER);
    });
    expect(lines[0]).toBe('[forkable-bot] run.no_mailer_configured');
  });

  test('emits event name plus JSON data when payload is non-empty', () => {
    const logger = createLogger(baseSettings);
    const lines = captureStdout(() => {
      logger.info(LOG_EVENTS.RUN_TARGET_WEEK, { from: '2026-05-04' });
    });
    expect(lines[0]).toBe('[forkable-bot] run.target_week {"from":"2026-05-04"}');
  });

  test('warn() prefixes WARN and goes to stdout', () => {
    const logger = createLogger(baseSettings);
    const lines = captureStdout(() => {
      logger.warn(LOG_EVENTS.RUN_NO_MAILER);
    });
    expect(lines[0]).toBe('[forkable-bot] WARN run.no_mailer_configured');
  });

  test('error() prefixes ERROR and routes to stderr', () => {
    const lines = captureStderr(() => {
      createLogger(baseSettings).error(LOG_EVENTS.SCORER_NETWORK_FAILED, { candidate: 'x' });
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('[forkable-bot] ERROR scorer.network_failed {"candidate":"x"}');
  });

  test('debug() is suppressed unless settings.debug is true', () => {
    const lines = captureStdout(() => {
      createLogger(baseSettings).debug(LOG_EVENTS.FORKABLE_POST_OUT);
      createLogger({ ...baseSettings, debug: true }).debug(LOG_EVENTS.FORKABLE_POST_OUT);
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('DEBUG');
    expect(lines[0]).toContain('forkable.post_out');
  });
});
