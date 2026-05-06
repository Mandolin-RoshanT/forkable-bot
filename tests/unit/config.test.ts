import { describe, expect, test } from 'bun:test';

import { loadSettings } from '../../src/config.ts';

const VALID_ENV = {
  FORKABLE_EMAIL: 'roshan@mandolin.com',
  FORKABLE_PASSWORD: 'hunter2',
  OPENAI_API_KEY: 'sk-xxx',
  RESEND_API_KEY: 're_yyy',
  NOTIFY_TO_EMAIL: 'roshan@mandolin.com',
  NOTIFY_FROM_EMAIL: 'bot@example.com',
};

describe('loadSettings', () => {
  test('parses a valid environment', () => {
    const settings = loadSettings(VALID_ENV);
    expect(settings.forkable.email).toBe('roshan@mandolin.com');
    expect(settings.forkable.password).toBe('hunter2');
    expect(settings.openaiApiKey).toBe('sk-xxx');
    expect(settings.resend.notifyTo).toBe('roshan@mandolin.com');
    expect(settings.debug).toBe(false);
  });

  test('DEBUG=1 enables debug mode', () => {
    expect(loadSettings({ ...VALID_ENV, DEBUG: '1' }).debug).toBe(true);
  });

  test('throws with a clear message when a required field is missing', () => {
    const { OPENAI_API_KEY: _, ...withoutOpenAI } = VALID_ENV;
    expect(() => loadSettings(withoutOpenAI)).toThrow(/openaiApiKey/);
  });

  test('rejects an invalid email format', () => {
    expect(() => loadSettings({ ...VALID_ENV, FORKABLE_EMAIL: 'not-an-email' })).toThrow(
      /forkable\.email/,
    );
  });
});
