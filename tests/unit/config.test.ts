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
  test('parses a valid environment with default OpenAI provider', () => {
    const settings = loadSettings(VALID_ENV);
    expect(settings.forkable.email).toBe('roshan@mandolin.com');
    expect(settings.forkable.password).toBe('hunter2');
    expect(settings.scorer.provider).toBe('openai');
    expect(settings.scorer.apiKey).toBe('sk-xxx');
    expect(settings.resend.notifyTo).toBe('roshan@mandolin.com');
    expect(settings.debug).toBe(false);
  });

  test("SCORER_PROVIDER='' (empty string) falls back to OpenAI", () => {
    const settings = loadSettings({ ...VALID_ENV, SCORER_PROVIDER: '' });
    expect(settings.scorer.provider).toBe('openai');
  });

  test('SCORER_PROVIDER=anthropic uses ANTHROPIC_API_KEY', () => {
    const settings = loadSettings({
      ...VALID_ENV,
      SCORER_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: 'sk-ant-zzz',
    });
    expect(settings.scorer.provider).toBe('anthropic');
    expect(settings.scorer.apiKey).toBe('sk-ant-zzz');
  });

  test('DEBUG=1 enables debug mode', () => {
    expect(loadSettings({ ...VALID_ENV, DEBUG: '1' }).debug).toBe(true);
  });

  test('throws when the OpenAI key is missing', () => {
    const { OPENAI_API_KEY: _, ...withoutOpenAI } = VALID_ENV;
    expect(() => loadSettings(withoutOpenAI)).toThrow(/scorer\.apiKey/);
  });

  test('throws when SCORER_PROVIDER=anthropic but ANTHROPIC_API_KEY is missing', () => {
    expect(() => loadSettings({ ...VALID_ENV, SCORER_PROVIDER: 'anthropic' })).toThrow(
      /scorer\.apiKey/,
    );
  });

  test('throws on an unknown SCORER_PROVIDER value', () => {
    expect(() => loadSettings({ ...VALID_ENV, SCORER_PROVIDER: 'cohere' })).toThrow(/scorer/);
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
