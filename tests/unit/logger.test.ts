import { describe, expect, test } from 'bun:test';

import type { Settings } from '../../src/config.ts';
import { createLogger } from '../../src/logger.ts';

const baseSettings: Settings = {
  forkable: { email: 'r@example.com', password: 'super-secret-pw' },
  openaiApiKey: 'sk-openai-key-12345',
  resend: {
    apiKey: 're_resend_key_67890',
    notifyTo: 'r@example.com',
    notifyFrom: 'bot@example.com',
  },
  debug: false,
};

describe('createLogger', () => {
  test('scrubs the forkable password from messages', () => {
    const logger = createLogger(baseSettings);
    const captured: string[] = [];
    const original = console.log;
    console.log = (msg: string) => captured.push(msg);
    try {
      logger.info('login failed for password=super-secret-pw');
    } finally {
      console.log = original;
    }
    expect(captured[0]).toContain('<redacted>');
    expect(captured[0]).not.toContain('super-secret-pw');
  });

  test('scrubs the openai key from messages', () => {
    const logger = createLogger(baseSettings);
    const captured: string[] = [];
    const original = console.log;
    console.log = (msg: string) => captured.push(msg);
    try {
      logger.info('Authorization: Bearer sk-openai-key-12345');
    } finally {
      console.log = original;
    }
    expect(captured[0]).not.toContain('sk-openai-key-12345');
  });

  test('debug() is suppressed unless settings.debug is true', () => {
    const captured: string[] = [];
    const original = console.log;
    console.log = (msg: string) => captured.push(msg);
    try {
      createLogger(baseSettings).debug('quiet');
      createLogger({ ...baseSettings, debug: true }).debug('loud');
    } finally {
      console.log = original;
    }
    expect(captured).toHaveLength(1);
    expect(captured[0]).toContain('loud');
  });

  test('error() routes to stderr', () => {
    const captured: string[] = [];
    const original = console.error;
    console.error = (msg: string) => captured.push(msg);
    try {
      createLogger(baseSettings).error('boom');
    } finally {
      console.error = original;
    }
    expect(captured).toHaveLength(1);
    expect(captured[0]).toContain('boom');
  });
});
