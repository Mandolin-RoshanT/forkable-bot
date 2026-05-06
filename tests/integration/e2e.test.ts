// End-to-end integration test: picker + ForkableClient + Zod schemas.
//
// MSW serves the M1 captures as canned responses; pickWeek runs against a
// real ForkableClient with a deterministic stub scorer. This is the test
// that catches breaks at the seams (schema parse → picker decision →
// client mutation → schema parse).

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { ForkableClient } from '../../src/clients/forkable.ts';
import { pickWeek } from '../../src/core/picker.ts';
import type { Logger } from '../../src/logger.ts';
import type { Score } from '../../src/models.ts';

const FORKABLE_GRAPHQL = 'https://forkable.com/api/v2/graphql';
const CAPTURES = resolve(import.meta.dir, '../../scripts/captures');

const silentLogger: Logger = { info: () => {}, error: () => {}, debug: () => {} };

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Stub scorer: "Beef Stew" wins green, everything else red. Beef Stew is
// menuId=17826, itemId=33 in the captured alternatives — see swap-meal.json.
const scoreBeefStewGreen = async (cand: { name: string }): Promise<Score> => {
  if (cand.name === 'Beef Stew') {
    return { bucket: 'green', reasoning: 'lean protein, low carb' };
  }
  return { bucket: 'red', reasoning: 'stub: not green' };
};

// The captured get-alternatives.json is for menus [15167, 17003, 17826,
// 13408] (Wed 2026-05-06 in the captured week). Only that day's
// availableMenuIds match those alternatives, so for a deterministic test
// we force the rest of the week locked and Wed editable. The picker only
// gets one editable day to act on.
async function loadFixedWeek() {
  const captured = await Bun.file(`${CAPTURES}/get-week.json`).json();
  const week = JSON.parse(JSON.stringify(captured));
  for (const d of week.data.myDeliveries) {
    d.isReadOnly = !d.forDeliveryAt.startsWith('2026-05-06');
  }
  return week;
}

describe('e2e — pickWeek + ForkableClient + captures', () => {
  test('locked days are skipped; editable day swaps to the green item', async () => {
    const fixedWeek = await loadFixedWeek();
    const capturedAlts = await Bun.file(`${CAPTURES}/get-alternatives.json`).json();
    const replacePieceCalls: unknown[] = [];

    server.use(
      http.post(FORKABLE_GRAPHQL, async ({ request }) => {
        const body = (await request.clone().json()) as {
          operationName?: string;
          query: string;
          variables?: unknown;
        };

        // Warmup: anonymous { __typename } → 401 with ALB-style cookie.
        if (body.query?.includes('__typename')) {
          return new HttpResponse('Unauthorized', {
            status: 401,
            headers: { 'Set-Cookie': 'AWSALBTG=warmup-cookie; Path=/' },
          });
        }

        switch (body.operationName) {
          case 'CreateSession':
            return HttpResponse.json(
              {
                data: {
                  createSession: {
                    user: { id: 305827, email: 'r@example.com', mfaEnabled: false },
                    errorAttributes: null,
                    errorDetails: null,
                  },
                },
              },
              { headers: { 'Set-Cookie': '_easyorder_session=session-cookie-aaa; Path=/' } },
            );

          case 'Me':
            return HttpResponse.json({
              data: { me: { id: 305827, email: 'r@example.com', mfaEnabled: false } },
            });

          case 'GetWeek':
            return HttpResponse.json(fixedWeek);

          case 'GetAlternatives':
            return HttpResponse.json(capturedAlts);

          case 'ReplacePiece':
            replacePieceCalls.push(body.variables);
            return HttpResponse.json({
              data: {
                replacePiece: {
                  delivery: {
                    id: 1175988,
                    state: 'initial',
                    isReadOnly: false,
                    orders: [],
                  },
                },
              },
            });

          default:
            return HttpResponse.json({
              errors: [{ message: `unhandled op: ${body.operationName}` }],
            });
        }
      }),
    );

    const client = new ForkableClient({ email: 'r@example.com', password: 'pw' }, silentLogger);
    await client.login();
    const days = await client.getWeek('2026-05-04');

    const result = await pickWeek({
      from: '2026-05-04',
      days,
      alternativesFor: (_deliveryId, menuIds, clubId) => client.getAlternatives(menuIds, clubId),
      score: scoreBeefStewGreen,
      swap: (input) => client.swapMeal(input),
      dryRun: false,
    });

    const counts = {
      locked: result.days.filter((d) => d.kind === 'skipped-locked').length,
      swapped: result.days.filter((d) => d.kind === 'swapped').length,
      kept: result.days.filter((d) => d.kind === 'kept-default').length,
      failed: result.days.filter((d) => d.kind === 'failed').length,
    };

    expect(counts.locked).toBe(4);
    expect(counts.swapped).toBe(1);
    expect(counts.failed).toBe(0);
    expect(replacePieceCalls).toHaveLength(1);

    // The single swap targets Beef Stew @ Saucy Greens (menu 17826 / item 33).
    const input = (
      replacePieceCalls[0] as {
        input: { menuId: number; itemId: number; selectionsHash: object };
      }
    ).input;
    expect(input.menuId).toBe(17826);
    expect(input.itemId).toBe(33);
    expect(input.selectionsHash).toEqual({});
  });

  test('dry-run with the same fixtures issues zero mutations', async () => {
    const fixedWeek = await loadFixedWeek();
    const capturedAlts = await Bun.file(`${CAPTURES}/get-alternatives.json`).json();
    const replacePieceCalls: unknown[] = [];

    server.use(
      http.post(FORKABLE_GRAPHQL, async ({ request }) => {
        const body = (await request.clone().json()) as {
          operationName?: string;
          query: string;
        };
        if (body.query?.includes('__typename')) {
          return new HttpResponse(null, {
            status: 401,
            headers: { 'Set-Cookie': 'AWSALBTG=warm; Path=/' },
          });
        }
        switch (body.operationName) {
          case 'CreateSession':
            return HttpResponse.json(
              {
                data: {
                  createSession: {
                    user: { id: 305827, email: 'r@example.com', mfaEnabled: false },
                    errorAttributes: null,
                    errorDetails: null,
                  },
                },
              },
              { headers: { 'Set-Cookie': '_easyorder_session=cookie; Path=/' } },
            );
          case 'Me':
            return HttpResponse.json({
              data: { me: { id: 305827, email: 'r@example.com', mfaEnabled: false } },
            });
          case 'GetWeek':
            return HttpResponse.json(fixedWeek);
          case 'GetAlternatives':
            return HttpResponse.json(capturedAlts);
          case 'ReplacePiece':
            replacePieceCalls.push(body);
            return HttpResponse.json({ data: {} });
          default:
            return HttpResponse.json({ errors: [{ message: 'unhandled' }] });
        }
      }),
    );

    const client = new ForkableClient({ email: 'r@example.com', password: 'pw' }, silentLogger);
    await client.login();
    const days = await client.getWeek('2026-05-04');

    await pickWeek({
      from: '2026-05-04',
      days,
      alternativesFor: (_d, menuIds, clubId) => client.getAlternatives(menuIds, clubId),
      score: scoreBeefStewGreen,
      swap: (input) => client.swapMeal(input),
      dryRun: true,
    });

    expect(replacePieceCalls).toHaveLength(0);
  });
});
