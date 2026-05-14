import { describe, expect, test } from 'bun:test';

import { loadSettings } from '../../src/config.ts';

const VALID_ENV = {
  FORKABLE_EMAIL: 'user@example.com',
  FORKABLE_PASSWORD: 'hunter2',
  OPENAI_API_KEY: 'sk-xxx',
  RESEND_API_KEY: 're_yyy',
  NOTIFY_TO_EMAIL: 'user@example.com',
  NOTIFY_FROM_EMAIL: 'bot@example.com',
};

describe('loadSettings', () => {
  test('parses a valid environment', () => {
    const settings = loadSettings(VALID_ENV);
    expect(settings.forkable.email).toBe('user@example.com');
    expect(settings.forkable.password).toBe('hunter2');
    expect(settings.openaiApiKey).toBe('sk-xxx');
    expect(settings.resend.notifyTo).toBe('user@example.com');
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

  test("NOTIFY_FROM_EMAIL is optional — defaults to Resend's sender", () => {
    const { NOTIFY_FROM_EMAIL: _, ...withoutFrom } = VALID_ENV;
    expect(loadSettings(withoutFrom).resend.notifyFrom).toBe('onboarding@resend.dev');
  });

  test("NOTIFY_FROM_EMAIL='' (empty string) also falls back to the default", () => {
    expect(loadSettings({ ...VALID_ENV, NOTIFY_FROM_EMAIL: '' }).resend.notifyFrom).toBe(
      'onboarding@resend.dev',
    );
  });
});
