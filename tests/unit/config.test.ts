import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_FORKABLE_TIMEOUT_MS,
  DEFAULT_RESEND_FROM,
  DEFAULT_RESEND_TIMEOUT_MS,
  loadSettings,
} from '../../src/config.ts';

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
    expect(loadSettings(withoutFrom).resend.notifyFrom).toBe(DEFAULT_RESEND_FROM);
  });

  test("NOTIFY_FROM_EMAIL='' (empty string) also falls back to the default", () => {
    expect(loadSettings({ ...VALID_ENV, NOTIFY_FROM_EMAIL: '' }).resend.notifyFrom).toBe(
      DEFAULT_RESEND_FROM,
    );
  });

  test('timeoutMs values default when env vars are absent', () => {
    const settings = loadSettings(VALID_ENV);
    expect(settings.forkable.timeoutMs).toBe(DEFAULT_FORKABLE_TIMEOUT_MS);
    expect(settings.resend.timeoutMs).toBe(DEFAULT_RESEND_TIMEOUT_MS);
  });

  test('FORKABLE_TIMEOUT_MS / RESEND_TIMEOUT_MS override the defaults', () => {
    const settings = loadSettings({
      ...VALID_ENV,
      FORKABLE_TIMEOUT_MS: '5000',
      RESEND_TIMEOUT_MS: '2000',
    });
    expect(settings.forkable.timeoutMs).toBe(5000);
    expect(settings.resend.timeoutMs).toBe(2000);
  });

  test('rejects a non-positive timeout', () => {
    expect(() => loadSettings({ ...VALID_ENV, FORKABLE_TIMEOUT_MS: '0' })).toThrow(
      /forkable\.timeoutMs/,
    );
  });

  describe('optional sections', () => {
    test("optional: ['resend'] fills in placeholders when RESEND_* vars are missing", () => {
      const { RESEND_API_KEY: _r, NOTIFY_TO_EMAIL: _n, ...withoutResend } = VALID_ENV;
      const settings = loadSettings(withoutResend, { optional: ['resend'] });
      expect(settings.resend.apiKey).toBe('unused-placeholder');
      expect(settings.resend.notifyTo).toBe('noreply@example.com');
      // Forkable creds are still required.
      expect(settings.forkable.email).toBe('user@example.com');
    });

    test("optional: ['openai'] fills in the OpenAI key when missing", () => {
      const { OPENAI_API_KEY: _o, ...withoutOpenAI } = VALID_ENV;
      const settings = loadSettings(withoutOpenAI, { optional: ['openai'] });
      expect(settings.openaiApiKey).toBe('unused-placeholder');
    });

    test('without optional, missing RESEND_API_KEY still throws', () => {
      const { RESEND_API_KEY: _r, ...withoutResend } = VALID_ENV;
      expect(() => loadSettings(withoutResend)).toThrow(/resend\.apiKey/);
    });

    test('without optional, missing OPENAI_API_KEY still throws', () => {
      const { OPENAI_API_KEY: _o, ...withoutOpenAI } = VALID_ENV;
      expect(() => loadSettings(withoutOpenAI)).toThrow(/openaiApiKey/);
    });

    test('a real value in env wins over the placeholder even when section is optional', () => {
      const settings = loadSettings(VALID_ENV, { optional: ['openai', 'resend'] });
      expect(settings.openaiApiKey).toBe('sk-xxx');
      expect(settings.resend.apiKey).toBe('re_yyy');
    });

    test('forkable section is never optional — missing FORKABLE_PASSWORD still throws', () => {
      const { FORKABLE_PASSWORD: _p, ...withoutPw } = VALID_ENV;
      expect(() => loadSettings(withoutPw, { optional: ['openai', 'resend'] })).toThrow(
        /forkable\.password/,
      );
    });
  });
});
