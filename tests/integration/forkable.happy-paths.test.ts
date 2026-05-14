// ForkableClient — happy paths: login + me + read methods + the locked
// v1 swap input contract. Each test sets up the MSW handlers it needs;
// real Forkable captures power the parse tests so schema drift surfaces.

import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { http, HttpResponse } from 'msw';

import { ForkableClient } from '../../src/clients/forkable.ts';
import {
  FORKABLE_GRAPHQL,
  createSessionOk,
  createTestServer,
  graphqlHandler,
  meOk,
  silentLogger,
} from '../fixtures/msw.ts';
import { baseSettings } from '../helpers/forkable-base.ts';

const CAPTURES = resolve(import.meta.dir, '../../scripts/captures');

const server = createTestServer();

describe('ForkableClient — happy paths', () => {
  test('login() succeeds, captures cookies, returns user', async () => {
    server.use(graphqlHandler({ CreateSession: createSessionOk }));

    const client = new ForkableClient(baseSettings.forkable, silentLogger);
    const user = await client.login();
    expect(user.id).toBe(100001);
    expect(user.email).toBe('test@example.com');
    expect(user.mfaEnabled).toBe(false);
  });

  test('me() returns the authenticated user', async () => {
    server.use(graphqlHandler({ CreateSession: createSessionOk, Me: meOk }));

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
      graphqlHandler({ CreateSession: createSessionOk }),
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
      client.swapMeal({ deliveryId: 1, oldPieceId: 'x', menuId: 1, itemId: 1 }),
    ).rejects.toThrow(/must login/);
  });
});
