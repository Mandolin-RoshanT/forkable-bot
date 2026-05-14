// ForkableClient — error paths: auth failures, transport (HTTP, JSON,
// GraphQL-level), and the schema-drift recovery flow. Each test asserts
// on the structured fields of the unified ForkableError so future shape
// regressions surface as test failures.

import { describe, expect, test } from 'bun:test';
import { HttpResponse } from 'msw';

import { ForkableError } from '../../src/clients/forkable-errors.ts';
import { ForkableClient } from '../../src/clients/forkable.ts';
import {
  SESSION_COOKIE_HEADERS,
  VALID_USER,
  createSessionOk,
  createTestServer,
  graphqlHandler,
  silentLogger,
} from '../fixtures/msw.ts';
import { baseSettings } from '../helpers/forkable-base.ts';

const server = createTestServer();

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
