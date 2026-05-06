// Verifies the PRD §13 failure-email path: when runPicker fails, the
// ResendMailer is constructed and sendFailure() actually hits Resend.
//
// We mock both forkable.com (so login fails on demand) AND api.resend.com
// (so we can assert a POST was made). Env vars are mutated and restored
// around the test so we don't pollute other tests.

import { describe, expect, test } from 'bun:test';
import { http, HttpResponse } from 'msw';

import { run } from '../../src/cli.ts';
import { RESEND_ENDPOINT, createTestServer, graphqlHandler } from '../fixtures/msw.ts';

const server = createTestServer({ onUnhandledRequest: 'bypass' });

// ─── env helpers ──────────────────────────────────────────────────────────

const TEST_ENV: Record<string, string> = {
  FORKABLE_EMAIL: 'test@example.com',
  FORKABLE_PASSWORD: 'wrong-password',
  OPENAI_API_KEY: 'sk-test-key',
  RESEND_API_KEY: 're_test_key',
  NOTIFY_TO_EMAIL: 'roshan@example.com',
  NOTIFY_FROM_EMAIL: 'bot@example.com',
};

function withTestEnv<T>(fn: () => Promise<T>): Promise<T> {
  const restore: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(TEST_ENV)) {
    restore[k] = process.env[k];
    process.env[k] = v;
  }
  return fn().finally(() => {
    for (const [k, v] of Object.entries(restore)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

// ─── tests ─────────────────────────────────────────────────────────────────

describe('runPicker failure → mailer.sendFailure', () => {
  test('login failure triggers a Resend POST with the right subject', async () => {
    const resendCalls: { subject: string; text: string }[] = [];

    server.use(
      graphqlHandler({
        CreateSession: () =>
          HttpResponse.json({
            data: {
              createSession: {
                user: null,
                errorAttributes: { email: 'invalid' },
                errorDetails: 'wrong password',
              },
            },
          }),
      }),
      http.post(RESEND_ENDPOINT, async ({ request }) => {
        const body = (await request.json()) as { subject: string; text: string };
        resendCalls.push(body);
        return HttpResponse.json({ id: 'msg-id' });
      }),
    );

    await withTestEnv(async () => {
      await expect(run(['bun', 'src/index.ts', 'pick'])).rejects.toThrow();
    });

    expect(resendCalls).toHaveLength(1);
    const call = resendCalls[0];
    if (!call) throw new Error('unreachable');
    expect(call.subject).toContain('pick');
    expect(call.subject.toLowerCase()).toContain('error');
    expect(call.text).toContain('createSession');
  });

  test('dry-run failure also triggers the mailer (with mode=dry-run in subject)', async () => {
    const resendCalls: { subject: string }[] = [];

    server.use(
      graphqlHandler({
        CreateSession: () => new HttpResponse('boom', { status: 500 }),
      }),
      http.post(RESEND_ENDPOINT, async ({ request }) => {
        resendCalls.push((await request.json()) as { subject: string });
        return HttpResponse.json({ id: 'msg-id' });
      }),
    );

    await withTestEnv(async () => {
      await expect(run(['bun', 'src/index.ts', 'dry-run'])).rejects.toThrow();
    });

    expect(resendCalls).toHaveLength(1);
    expect(resendCalls[0]?.subject).toContain('dry-run');
  });
});
