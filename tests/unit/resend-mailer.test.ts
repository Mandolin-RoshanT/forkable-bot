import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { ResendError } from '../../src/clients/resend-errors.ts';
import { ResendMailer } from '../../src/clients/resend-mailer.ts';
import type { FetchFn } from '../../src/lib/fetch.ts';
import { silentLogger } from '../fixtures/msw.ts';

const config = {
  apiKey: 're_test_key',
  from: 'bot@example.com',
  to: 'user@example.com',
};

// We patch the global `fetch` for these tests rather than pulling in MSW —
// ResendMailer is a single-method facade and a tiny fetch shim is clearer.

let capturedRequests: Array<{ url: string; init: RequestInit }> = [];
let nextResponse: Response = new Response(null, { status: 200 });
let originalFetch: typeof fetch;

beforeEach(() => {
  capturedRequests = [];
  nextResponse = new Response(JSON.stringify({ id: 'sent-id' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    capturedRequests.push({ url: String(input), init: init ?? {} });
    return nextResponse;
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function firstRequest(): { url: string; init: RequestInit } {
  const req = capturedRequests[0];
  if (!req) {
    throw new Error('expected at least one captured request');
  }
  return req;
}

describe('ResendMailer.sendFailure', () => {
  test('hits the right endpoint with bearer auth', async () => {
    await new ResendMailer(config, silentLogger).sendFailure({
      mode: 'pick',
      error: new Error('something blew up'),
    });

    expect(capturedRequests).toHaveLength(1);
    const req = firstRequest();
    expect(req.url).toBe('https://api.resend.com/emails');
    expect(req.init.method).toBe('POST');

    const headers = req.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer re_test_key');
    expect(headers['Content-Type']).toBe('application/json');
  });

  test('puts the mode + error message into subject + body', async () => {
    await new ResendMailer(config, silentLogger).sendFailure({
      mode: 'dry-run',
      error: new Error('login failed'),
    });

    const body = JSON.parse(String(firstRequest().init.body));
    expect(body.from).toBe('bot@example.com');
    expect(body.to).toBe('user@example.com');
    expect(body.subject).toContain('dry-run');
    expect(body.subject).toContain('Error');
    expect(body.text).toContain('login failed');
  });

  test('throws on non-2xx', async () => {
    nextResponse = new Response('bad token', { status: 401 });
    const mailer = new ResendMailer(config, silentLogger);
    const err = (await mailer
      .sendFailure({ mode: 'pick', error: new Error('x') })
      .catch((e) => e)) as ResendError;
    expect(err).toBeInstanceOf(ResendError);
    expect(err.status).toBe(401);
    expect(err.body).toBe('bad token');
    expect(err.context.operation).toBe('sendFailure');
  });

  test('aborts a hung Resend request via the timeout', async () => {
    // Inject a fetchFn that hangs until the AbortSignal fires — this
    // bypasses the global fetch shim entirely (preferred per
    // .claude/rules/deliverables.md).
    const fetchFn: FetchFn = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });

    const mailer = new ResendMailer(config, silentLogger, { fetchFn, timeoutMs: 10 });
    const err = (await mailer
      .sendFailure({ mode: 'pick', error: new Error('underlying failure') })
      .catch((e) => e)) as ResendError;
    expect(err).toBeInstanceOf(ResendError);
    expect(err.message).toMatch(/timed out/);
    expect(err.context.timeoutMs).toBe(10);
    expect(err.context.operation).toBe('sendFailure');
    expect((err.cause as Error).name).toBe('AbortError');
  });

  test('wraps non-timeout fetch failures as ResendError', async () => {
    const fetchFn: FetchFn = () => Promise.reject(new TypeError('fetch failed'));

    const mailer = new ResendMailer(config, silentLogger, { fetchFn });
    const err = (await mailer
      .sendFailure({ mode: 'dry-run', error: new Error('x') })
      .catch((e) => e)) as ResendError;
    expect(err).toBeInstanceOf(ResendError);
    expect(err.message).toMatch(/fetch failed/);
    expect((err.cause as Error).message).toBe('fetch failed');
  });
});
