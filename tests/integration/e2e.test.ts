// End-to-end integration test: picker + ForkableClient + Zod schemas.
//
// MSW serves the M1 captures as canned responses; pickWeek runs against a
// real ForkableClient with a deterministic stub scorer. This is the test
// that catches breaks at the seams (schema parse → picker decision →
// client mutation → schema parse).

import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { http, HttpResponse } from 'msw';

import { ForkableClient } from '../../src/clients/forkable.ts';
import { pickWeek } from '../../src/core/picker.ts';
import type { Score } from '../../src/models.ts';
import {
  FORKABLE_GRAPHQL,
  createSessionOk,
  createTestServer,
  graphqlHandler,
  meOk,
  silentLogger,
} from '../fixtures/msw.ts';

const CAPTURES = resolve(import.meta.dir, '../../scripts/captures');

const server = createTestServer();

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
      // Inline first so we can capture variables from ReplacePiece before
      // graphqlHandler dispatches by operationName.
      http.post(FORKABLE_GRAPHQL, async ({ request }) => {
        const body = (await request.clone().json()) as {
          operationName?: string;
          variables?: unknown;
        };
        if (body.operationName !== 'ReplacePiece') {
          return undefined;
        }
        replacePieceCalls.push(body.variables);
        return HttpResponse.json({
          data: {
            replacePiece: {
              delivery: { id: 1175988, state: 'initial', isReadOnly: false, orders: [] },
            },
          },
        });
      }),
      graphqlHandler({
        CreateSession: createSessionOk,
        Me: meOk,
        GetWeek: () => HttpResponse.json(fixedWeek),
        GetAlternatives: () => HttpResponse.json(capturedAlts),
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
        const body = (await request.clone().json()) as { operationName?: string };
        if (body.operationName !== 'ReplacePiece') {
          return undefined;
        }
        replacePieceCalls.push(body);
        return HttpResponse.json({ data: {} });
      }),
      graphqlHandler({
        CreateSession: createSessionOk,
        Me: meOk,
        GetWeek: () => HttpResponse.json(fixedWeek),
        GetAlternatives: () => HttpResponse.json(capturedAlts),
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
