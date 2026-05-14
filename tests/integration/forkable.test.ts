// MSW-backed regression tests for ForkableClient.
//
// We intercept the GraphQL endpoint, return canned responses (often shaped
// from the M1 captures), and assert the client's behavior — happy paths and
// every typed-error path. No real network calls.

import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { http, HttpResponse } from 'msw';

import { ForkableError } from '../../src/clients/forkable-errors.ts';
import { ForkableClient } from '../../src/clients/forkable.ts';
import type { Settings } from '../../src/config.ts';
import {
  FORKABLE_GRAPHQL,
  SESSION_COOKIE_HEADERS,
  VALID_USER,
  createSessionOk,
  createTestServer,
  graphqlHandler,
  meOk,
  silentLogger,
} from '../fixtures/msw.ts';

const CAPTURES = resolve(import.meta.dir, '../../scripts/captures');

const baseSettings: Settings = {
  forkable: { email: 'test@example.com', password: 'pw' },
  openaiApiKey: 'unused',
  resend: { apiKey: 'unused', notifyTo: 'a@b.com', notifyFrom: 'b@c.com' },
  debug: false,
};

const server = createTestServer();

// ─── Happy paths ──────────────────────────────────────────────────────────

describe('ForkableClient — happy paths', () => {
  test('login() succeeds, captures cookies, returns user', async () => {
    server.use(
      graphqlHandler({
        CreateSession: createSessionOk,
      }),
    );

    const client = new ForkableClient(baseSettings.forkable, silentLogger);
    const user = await client.login();
    expect(user.id).toBe(100001);
    expect(user.email).toBe('test@example.com');
    expect(user.mfaEnabled).toBe(false);
  });

  test('me() returns the authenticated user', async () => {
    server.use(
      graphqlHandler({
        CreateSession: createSessionOk,
        Me: meOk,
      }),
    );

    const client = new ForkableClient(baseSettings.forkable, silentLogger);
    await client.login();
    const me = await client.me();
    expect(me.id).toBe(100001);
  });

  test('getWeek() parses a real captured response', async () => {
    const capturedWeek = await Bun.file(`${CAPTURES}/get-week.json`).json();
    server.use(
      graphqlHandler({
        CreateSession: createSessionOk,
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
        CreateSession: createSessionOk,
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

  test('swapMeal() sends locked input shape and parses the response', async () => {
    let capturedVariables: unknown = null;
    server.use(
      // ReplacePiece-specific handler first — MSW checks handlers in registration
      // order, and graphqlHandler() below is the fallback.
      http.post(FORKABLE_GRAPHQL, async ({ request }) => {
        const body = (await request.clone().json()) as {
          operationName?: string;
          variables?: unknown;
        };
        if (body.operationName !== 'ReplacePiece') {
          // Let the next handler take it.
          return undefined;
        }
        capturedVariables = body.variables;
        return HttpResponse.json({
          data: {
            replacePiece: {
              delivery: {
                id: 1175988,
                state: 'initial',
                isReadOnly: false,
                orders: [
                  {
                    id: 2580669,
                    pieces: [
                      {
                        id: 'new-piece-uuid',
                        itemId: 33,
                        menuId: 17826,
                        name: 'Beef Stew',
                        price: 21.5,
                      },
                    ],
                  },
                ],
              },
            },
          },
        });
      }),
      // Fallback for warmup + CreateSession.
      graphqlHandler({
        CreateSession: createSessionOk,
      }),
    );

    const client = new ForkableClient(baseSettings.forkable, silentLogger);
    await client.login();
    await client.swapMeal({
      deliveryId: 1175988,
      oldPieceId: 'old-piece-uuid',
      menuId: 17826,
      itemId: 33,
    });

    // Locked v1 contract: selectionsHash is empty, mirror SPA analytics fields.
    expect(capturedVariables).toEqual({
      input: {
        deliveryId: 1175988,
        oldPieceId: 'old-piece-uuid',
        menuId: 17826,
        itemId: 33,
        instructions: '',
        selectionsHash: {},
        fromTopRated: true,
        topRatedType: 'venue_rating',
        myMeals: true,
      },
    });
  });

  test('swapMeal() throws when called before login()', async () => {
    const client = new ForkableClient(baseSettings.forkable, silentLogger);
    await expect(
      client.swapMeal({
        deliveryId: 1,
        oldPieceId: 'x',
        menuId: 1,
        itemId: 1,
      }),
    ).rejects.toThrow(/must login/);
  });
});

// ─── Error paths ──────────────────────────────────────────────────────────

describe('ForkableClient — auth errors', () => {
  test('login() throws an auth-kind ForkableError when createSession returns no user', async () => {
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
    const err = (await client.login().catch((e) => e)) as ForkableError;
    expect(err).toBeInstanceOf(ForkableError);
    expect(err.kind).toBe('auth');
    expect(err.context.operation).toBe('createSession');
    expect(err.body).toEqual({
      errorAttributes: { email: 'invalid' },
      errorDetails: 'wrong password',
    });
  });

  test('login() throws an auth-kind ForkableError when MFA is enabled', async () => {
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

  test('login() throws an auth-kind ForkableError when no Set-Cookie returned', async () => {
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

  test('me() throws an auth-kind ForkableError when session cookie not accepted', async () => {
    server.use(
      graphqlHandler({
        CreateSession: createSessionOk,
        Me: () => HttpResponse.json({ data: { me: null } }),
      }),
    );

    const client = new ForkableClient(baseSettings.forkable, silentLogger);
    await client.login();
    const err = (await client.me().catch((e) => e)) as ForkableError;
    expect(err).toBeInstanceOf(ForkableError);
    expect(err.kind).toBe('auth');
    expect(err.context.operation).toBe('me');
  });
});

describe('ForkableClient — transport errors', () => {
  test('throws a network-kind ForkableError on 500', async () => {
    server.use(
      graphqlHandler({
        CreateSession: createSessionOk,
        GetWeek: () => new HttpResponse('Internal Server Error', { status: 500 }),
      }),
    );

    const client = new ForkableClient(baseSettings.forkable, silentLogger);
    await client.login();
    const err = (await client.getWeek('2026-05-04').catch((e) => e)) as ForkableError;
    expect(err).toBeInstanceOf(ForkableError);
    expect(err.kind).toBe('network');
    expect(err.status).toBe(500);
    expect(err.body).toContain('Internal Server Error');
    expect(err.context.operation).toBe('GetWeek');
  });

  test('throws a schema-kind ForkableError on non-JSON response', async () => {
    server.use(
      graphqlHandler({
        CreateSession: createSessionOk,
        GetWeek: () => new HttpResponse('not json', { status: 200 }),
      }),
    );

    const client = new ForkableClient(baseSettings.forkable, silentLogger);
    await client.login();
    const err = (await client.getWeek('2026-05-04').catch((e) => e)) as ForkableError;
    expect(err).toBeInstanceOf(ForkableError);
    expect(err.kind).toBe('schema');
    expect(err.cause).toBeDefined();
  });

  test('getAlternatives() throws a network-kind ForkableError on 500', async () => {
    server.use(
      graphqlHandler({
        CreateSession: createSessionOk,
        GetAlternatives: () => new HttpResponse('Internal Server Error', { status: 500 }),
      }),
    );

    const client = new ForkableClient(baseSettings.forkable, silentLogger);
    await client.login();
    const err = (await client.getAlternatives([1, 2, 3], 6059).catch((e) => e)) as ForkableError;
    expect(err).toBeInstanceOf(ForkableError);
    expect(err.kind).toBe('network');
    expect(err.status).toBe(500);
  });

  test('throws a schema-kind ForkableError when zod parse fails (schema drift)', async () => {
    server.use(
      graphqlHandler({
        CreateSession: createSessionOk,
        // Valid JSON, valid HTTP, but missing the required `myDeliveries` field.
        GetWeek: () => HttpResponse.json({ data: { somethingElse: [] } }),
      }),
    );

    const client = new ForkableClient(baseSettings.forkable, silentLogger);
    await client.login();
    const err = (await client.getWeek('2026-05-04').catch((e) => e)) as ForkableError;
    expect(err).toBeInstanceOf(ForkableError);
    expect(err.kind).toBe('schema');
    expect(err.context.operation).toBe('GetWeek');
    expect(err.cause).toBeDefined();
    expect((err.cause as Error).name).toBe('ZodError');
  });

  test('throws a graphql-kind ForkableError on GraphQL-level errors in response', async () => {
    server.use(
      graphqlHandler({
        CreateSession: createSessionOk,
        GetWeek: () =>
          HttpResponse.json({ errors: [{ message: "Field 'foo' doesn't exist on type 'Query'" }] }),
      }),
    );

    const client = new ForkableClient(baseSettings.forkable, silentLogger);
    await client.login();
    const err = (await client.getWeek('2026-05-04').catch((e) => e)) as ForkableError;
    expect(err).toBeInstanceOf(ForkableError);
    expect(err.kind).toBe('graphql');
    expect(err.body).toEqual([{ message: "Field 'foo' doesn't exist on type 'Query'" }]);
  });
});
