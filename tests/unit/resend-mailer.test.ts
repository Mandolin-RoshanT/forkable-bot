import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { ResendMailer } from '../../src/clients/resend-mailer.ts';
import { silentLogger } from '../fixtures/msw.ts';

const config = {
  apiKey: 're_test_key',
  from: 'bot@example.com',
  to: 'roshan@example.com',
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
    expect(body.to).toBe('roshan@example.com');
    expect(body.subject).toContain('dry-run');
    expect(body.subject).toContain('Error');
    expect(body.text).toContain('login failed');
  });

  test('throws on non-2xx', async () => {
    nextResponse = new Response('bad token', { status: 401 });
    const mailer = new ResendMailer(config, silentLogger);
    await expect(mailer.sendFailure({ mode: 'pick', error: new Error('x') })).rejects.toThrow(
      /HTTP 401/,
    );
  });
});
