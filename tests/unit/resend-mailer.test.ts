import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { ResendMailer } from '../../src/clients/resend-mailer.ts';
import type { Logger } from '../../src/logger.ts';
import type { WeekResult } from '../../src/models.ts';

const silentLogger: Logger = { info: () => {}, error: () => {}, debug: () => {} };

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

describe('ResendMailer.sendSummary', () => {
  test('formats one line per day', async () => {
    const result: WeekResult = {
      from: '2026-05-04',
      days: [
        { kind: 'skipped-locked', date: '2026-05-04' },
        {
          kind: 'kept-default',
          date: '2026-05-05',
          current: { venue: 'V', name: 'Default', price: 16 },
          bucket: 'green',
          reason: 'r',
        },
        {
          kind: 'swapped',
          date: '2026-05-06',
          from: { venue: 'A', name: 'Old', price: 16 },
          to: { venue: 'B', name: 'New', price: 18 },
          bucket: 'green',
          reasoning: 'r',
        },
      ],
    };

    await new ResendMailer(config, silentLogger).sendSummary(result);

    const body = JSON.parse(String(firstRequest().init.body));
    expect(body.subject).toContain('2026-05-04');
    expect(body.text).toContain('LOCKED');
    expect(body.text).toContain('KEEP');
    expect(body.text).toContain('SWAP');
    expect(body.text).toContain('A → B');
  });
});
