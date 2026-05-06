// MSW-backed regression tests for ForkableClient.
//
// We intercept the GraphQL endpoint, return canned responses (often shaped
// from the M1 captures), and assert the client's behavior — happy paths and
// every typed-error path. No real network calls.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import {
  ForkableAuthError,
  ForkableClient,
  ForkableError,
  ForkableNetworkError,
  ForkableSchemaError,
} from '../../src/clients/forkable.ts';
import type { Settings } from '../../src/config.ts';
import type { Logger } from '../../src/logger.ts';

const FORKABLE_GRAPHQL = 'https://forkable.com/api/v2/graphql';
const CAPTURES = resolve(import.meta.dir, '../../scripts/captures');

const silentLogger: Logger = {
  info: () => {},
  error: () => {},
  debug: () => {},
};

const baseSettings: Settings = {
  forkable: { email: 'test@example.com', password: 'pw' },
  openaiApiKey: 'unused',
  resend: { apiKey: 'unused', notifyTo: 'a@b.com', notifyFrom: 'b@c.com' },
  debug: false,
};

const VALID_USER = { id: 305827, email: 'test@example.com', mfaEnabled: false };

const SESSION_COOKIE_HEADERS = {
  'Set-Cookie': '_easyorder_session=AbCdEfGhIjKlMnOpQrStUvWxYz123456; Path=/; HttpOnly',
};

// ─── MSW lifecycle ────────────────────────────────────────────────────────

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Helper: dispatch on operationName so one handler can serve a whole flow.
function graphqlHandler(routes: Record<string, () => Response | Promise<Response>>) {
  return http.post(FORKABLE_GRAPHQL, async ({ request }) => {
    const body = (await request.json()) as { operationName?: string; query: string };
    const op = body.operationName;
    if (op && routes[op]) {
      return routes[op]();
    }
    // The warmup POST is anonymous (`{__typename}`) — treat it as a 401 with
    // ALB-like cookies so the client's warmup() captures them.
    if (body.query?.includes('__typename')) {
      return new HttpResponse('Unauthorized', {
        status: 401,
        headers: { 'Set-Cookie': 'AWSALBTG=warmup-cookie; Path=/' },
      });
    }
    return HttpResponse.json({ errors: [{ message: `unhandled op: ${op}` }] });
  });
}

// ─── Happy paths ──────────────────────────────────────────────────────────

describe('ForkableClient — happy paths', () => {
  test('login() succeeds, captures cookies, returns user', async () => {
    server.use(
      graphqlHandler({
        CreateSession: () =>
          HttpResponse.json(
            {
              data: {
                createSession: { user: VALID_USER, errorAttributes: null, errorDetails: null },
              },
            },
            { headers: SESSION_COOKIE_HEADERS },
          ),
      }),
    );

    const client = new ForkableClient(baseSettings.forkable, silentLogger);
    const user = await client.login();
    expect(user.id).toBe(305827);
    expect(user.email).toBe('test@example.com');
    expect(user.mfaEnabled).toBe(false);
  });

  test('me() returns the authenticated user', async () => {
    server.use(
      graphqlHandler({
        CreateSession: () =>
          HttpResponse.json(
            {
              data: {
                createSession: { user: VALID_USER, errorAttributes: null, errorDetails: null },
              },
            },
            { headers: SESSION_COOKIE_HEADERS },
          ),
        Me: () => HttpResponse.json({ data: { me: VALID_USER } }),
      }),
    );

    const client = new ForkableClient(baseSettings.forkable, silentLogger);
    await client.login();
    const me = await client.me();
    expect(me.id).toBe(305827);
  });

  test('getWeek() parses a real captured response', async () => {
    const capturedWeek = await Bun.file(`${CAPTURES}/get-week.json`).json();
    server.use(
      graphqlHandler({
        CreateSession: () =>
          HttpResponse.json(
            {
              data: {
                createSession: { user: VALID_USER, errorAttributes: null, errorDetails: null },
              },
            },
            { headers: SESSION_COOKIE_HEADERS },
          ),
        GetWeek: () => HttpResponse.json(capturedWeek),
      }),
    );

    const client = new ForkableClient(baseSettings.forkable, silentLogger);
    await client.login();
    const days = await client.getWeek('2026-05-04');
    expect(days).toHaveLength(5);
    expect(days.filter((d) => !d.isReadOnly).length).toBeGreaterThan(0);
  });

  test('getAlternatives() parses a real captured response', async () => {
    const capturedAlts = await Bun.file(`${CAPTURES}/get-alternatives.json`).json();
    server.use(
      graphqlHandler({
        CreateSession: () =>
          HttpResponse.json(
            {
              data: {
                createSession: { user: VALID_USER, errorAttributes: null, errorDetails: null },
              },
            },
            { headers: SESSION_COOKIE_HEADERS },
          ),
        GetAlternatives: () => HttpResponse.json(capturedAlts),
      }),
    );

    const client = new ForkableClient(baseSettings.forkable, silentLogger);
    await client.login();
    const menus = await client.getAlternatives([15167, 17003, 17826, 13408], 6059);
    expect(menus.length).toBeGreaterThan(0);
    for (const m of menus) {
      expect(m.sections.length).toBeGreaterThan(0);
    }
  });
});

// ─── Error paths ──────────────────────────────────────────────────────────

describe('ForkableClient — auth errors', () => {
  test('login() throws ForkableAuthError when createSession returns no user', async () => {
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
    );

    const client = new ForkableClient(baseSettings.forkable, silentLogger);
    await expect(client.login()).rejects.toBeInstanceOf(ForkableAuthError);
  });

  test('login() throws ForkableAuthError when MFA is enabled', async () => {
    server.use(
      graphqlHandler({
        CreateSession: () =>
          HttpResponse.json(
            {
              data: {
                createSession: {
                  user: { ...VALID_USER, mfaEnabled: true },
                  errorAttributes: null,
                  errorDetails: null,
                },
              },
            },
            { headers: SESSION_COOKIE_HEADERS },
          ),
      }),
    );

    const client = new ForkableClient(baseSettings.forkable, silentLogger);
    await expect(client.login()).rejects.toThrow(/MFA/);
  });

  test('login() throws ForkableAuthError when no Set-Cookie returned', async () => {
    server.use(
      graphqlHandler({
        CreateSession: () =>
          // No Set-Cookie header → client should fail
          HttpResponse.json({
            data: {
              createSession: { user: VALID_USER, errorAttributes: null, errorDetails: null },
            },
          }),
      }),
    );

    const client = new ForkableClient(baseSettings.forkable, silentLogger);
    await expect(client.login()).rejects.toThrow(/no new cookies/);
  });

  test('me() throws when called before login()', async () => {
    const client = new ForkableClient(baseSettings.forkable, silentLogger);
    await expect(client.me()).rejects.toThrow(/must login/);
  });

  test('getWeek() throws when called before login()', async () => {
    const client = new ForkableClient(baseSettings.forkable, silentLogger);
    await expect(client.getWeek('2026-05-04')).rejects.toThrow(/must login/);
  });

  test('me() throws ForkableAuthError when session cookie not accepted', async () => {
    server.use(
      graphqlHandler({
        CreateSession: () =>
          HttpResponse.json(
            {
              data: {
                createSession: { user: VALID_USER, errorAttributes: null, errorDetails: null },
              },
            },
            { headers: SESSION_COOKIE_HEADERS },
          ),
        Me: () => HttpResponse.json({ data: { me: null } }),
      }),
    );

    const client = new ForkableClient(baseSettings.forkable, silentLogger);
    await client.login();
    await expect(client.me()).rejects.toBeInstanceOf(ForkableAuthError);
  });
});

describe('ForkableClient — transport errors', () => {
  test('throws ForkableNetworkError on 500', async () => {
    server.use(
      graphqlHandler({
        CreateSession: () =>
          HttpResponse.json(
            {
              data: {
                createSession: { user: VALID_USER, errorAttributes: null, errorDetails: null },
              },
            },
            { headers: SESSION_COOKIE_HEADERS },
          ),
        GetWeek: () => new HttpResponse('Internal Server Error', { status: 500 }),
      }),
    );

    const client = new ForkableClient(baseSettings.forkable, silentLogger);
    await client.login();
    try {
      await client.getWeek('2026-05-04');
      throw new Error('expected ForkableNetworkError');
    } catch (err) {
      expect(err).toBeInstanceOf(ForkableNetworkError);
      expect((err as ForkableNetworkError).status).toBe(500);
    }
  });

  test('throws ForkableSchemaError on non-JSON response', async () => {
    server.use(
      graphqlHandler({
        CreateSession: () =>
          HttpResponse.json(
            {
              data: {
                createSession: { user: VALID_USER, errorAttributes: null, errorDetails: null },
              },
            },
            { headers: SESSION_COOKIE_HEADERS },
          ),
        GetWeek: () => new HttpResponse('not json', { status: 200 }),
      }),
    );

    const client = new ForkableClient(baseSettings.forkable, silentLogger);
    await client.login();
    await expect(client.getWeek('2026-05-04')).rejects.toBeInstanceOf(ForkableSchemaError);
  });

  test('throws ForkableError on GraphQL-level errors in response', async () => {
    server.use(
      graphqlHandler({
        CreateSession: () =>
          HttpResponse.json(
            {
              data: {
                createSession: { user: VALID_USER, errorAttributes: null, errorDetails: null },
              },
            },
            { headers: SESSION_COOKIE_HEADERS },
          ),
        GetWeek: () =>
          HttpResponse.json({ errors: [{ message: "Field 'foo' doesn't exist on type 'Query'" }] }),
      }),
    );

    const client = new ForkableClient(baseSettings.forkable, silentLogger);
    await client.login();
    await expect(client.getWeek('2026-05-04')).rejects.toBeInstanceOf(ForkableError);
  });
});
