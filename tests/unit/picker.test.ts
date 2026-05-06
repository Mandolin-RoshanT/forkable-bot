// Unit tests for pickWeek. Synthetic Delivery + injected callables — no
// network or LLM. Each test seeds a tiny world and asserts the WeekResult.

import { describe, expect, test } from 'bun:test';

import { type ScoreFn, type SwapFn, pickWeek } from '../../src/core/picker.ts';
import type { Bucket } from '../../src/models.ts';
import type { Delivery, Menu } from '../../src/schemas/forkable.ts';

// ─── factories ─────────────────────────────────────────────────────────────

function makeDelivery(overrides: Partial<Delivery> & Pick<Delivery, 'id'>): Delivery {
  return {
    state: 'initial',
    isReadOnly: false,
    forDeliveryAt: '2026-05-07T12:00:00.000Z',
    availableMenuIds: [],
    club: { id: 6059, name: 'Test Club' },
    orders: [],
    ...overrides,
  };
}

function makeMenu(
  id: number,
  displayName: string,
  items: { id: number; name: string; price?: number }[],
): Menu {
  return {
    id,
    name: displayName.toLowerCase(),
    displayName,
    venue: { id: id * 1000, name: displayName.toLowerCase(), displayName },
    sections: [
      {
        id: 1,
        name: 'main',
        items: items.map((it) => ({
          id: it.id,
          menuId: id,
          name: it.name,
          description: null,
          price: it.price ?? 15,
          ingredientTags: [],
          dietLevel: 3,
          averageRating: null,
          userRating: null,
          modifiers: [],
        })),
      },
    ],
  };
}

// One delivery with 4 menus; piece is the one named "Default".
function dayWithDefault(
  deliveryId: number,
  defaultMenuId: number,
  defaultItemId: number,
  defaultPieceId: string,
  date = '2026-05-07T12:00:00.000Z',
): Delivery {
  return makeDelivery({
    id: deliveryId,
    forDeliveryAt: date,
    availableMenuIds: [defaultMenuId, 200, 300, 400],
    orders: [
      {
        id: deliveryId * 10,
        state: 'initial',
        menu: { id: defaultMenuId, name: 'default-menu' },
        pieces: [
          {
            id: defaultPieceId,
            itemId: defaultItemId,
            menuId: defaultMenuId,
            name: 'Default',
            price: 16,
          },
        ],
      },
    ],
  });
}

const scoreByName: Record<string, Bucket> = {};
const scoreFn: ScoreFn = async (cand) => {
  const bucket = scoreByName[cand.name] ?? 'yellow';
  return { bucket, reasoning: `mock: ${bucket}` };
};

function makeAlternativesFn(menus: Menu[]) {
  return async () => menus;
}

const swapsFor = () => {
  const calls: { deliveryId: number; menuId: number; itemId: number; oldPieceId: string }[] = [];
  const fn: SwapFn = async (input) => {
    calls.push(input);
  };
  return { fn, calls };
};

// ─── tests ─────────────────────────────────────────────────────────────────

describe('pickWeek', () => {
  test('skips locked days without calling alternativesFor', async () => {
    let alternativesCalled = 0;
    const result = await pickWeek({
      from: '2026-05-04',
      days: [makeDelivery({ id: 1, isReadOnly: true })],
      alternativesFor: async () => {
        alternativesCalled++;
        return [];
      },
      score: scoreFn,
      swap: async () => {},
      dryRun: false,
    });
    expect(result.days).toHaveLength(1);
    expect(result.days[0]).toEqual({ kind: 'skipped-locked', date: '2026-05-07' });
    expect(alternativesCalled).toBe(0);
  });

  test('keeps default when default is already in the top bucket', async () => {
    scoreByName.Default = 'green';
    scoreByName.Other = 'yellow';
    const day = dayWithDefault(1175988, 100, 5, 'piece-uuid');
    const menus = [
      makeMenu(100, 'Default Venue', [{ id: 5, name: 'Default' }]),
      makeMenu(200, 'Other Venue', [{ id: 6, name: 'Other' }]),
    ];
    const swaps = swapsFor();

    const result = await pickWeek({
      from: '2026-05-04',
      days: [day],
      alternativesFor: makeAlternativesFn(menus),
      score: scoreFn,
      swap: swaps.fn,
      dryRun: false,
    });

    expect(result.days[0]?.kind).toBe('kept-default');
    expect(swaps.calls).toHaveLength(0);
  });

  test('swaps when an alternative outranks the default', async () => {
    scoreByName.Default = 'red';
    scoreByName.Better = 'green';
    const day = dayWithDefault(1175988, 100, 5, 'piece-uuid');
    const menus = [
      makeMenu(100, 'Default Venue', [{ id: 5, name: 'Default' }]),
      makeMenu(200, 'Better Venue', [{ id: 7, name: 'Better' }]),
    ];
    const swaps = swapsFor();

    const result = await pickWeek({
      from: '2026-05-04',
      days: [day],
      alternativesFor: makeAlternativesFn(menus),
      score: scoreFn,
      swap: swaps.fn,
      dryRun: false,
    });

    expect(result.days[0]?.kind).toBe('swapped');
    expect(swaps.calls).toEqual([
      { deliveryId: 1175988, menuId: 200, itemId: 7, oldPieceId: 'piece-uuid' },
    ]);
    if (result.days[0]?.kind === 'swapped') {
      expect(result.days[0].to.name).toBe('Better');
    }
  });

  test('dry-run never invokes swap', async () => {
    scoreByName.Default = 'red';
    scoreByName.Better = 'green';
    const day = dayWithDefault(1175988, 100, 5, 'piece-uuid');
    const menus = [
      makeMenu(100, 'Default Venue', [{ id: 5, name: 'Default' }]),
      makeMenu(200, 'Better Venue', [{ id: 7, name: 'Better' }]),
    ];
    const swaps = swapsFor();

    const result = await pickWeek({
      from: '2026-05-04',
      days: [day],
      alternativesFor: makeAlternativesFn(menus),
      score: scoreFn,
      swap: swaps.fn,
      dryRun: true,
    });

    expect(result.days[0]?.kind).toBe('swapped');
    expect(swaps.calls).toHaveLength(0);
  });

  test('idempotency: a second run on the post-swap state issues no swaps', async () => {
    scoreByName.OldDefault = 'red';
    scoreByName.NewDefault = 'green';
    // After the first swap, the new default IS in the top bucket — second run keeps it.
    const dayPostSwap = dayWithDefault(1175988, 200, 7, 'new-piece-uuid');
    const menus = [
      makeMenu(100, 'Old Venue', [{ id: 5, name: 'OldDefault' }]),
      makeMenu(200, 'New Venue', [{ id: 7, name: 'NewDefault' }]),
    ];
    const swaps = swapsFor();

    const result = await pickWeek({
      from: '2026-05-04',
      days: [dayPostSwap],
      alternativesFor: makeAlternativesFn(menus),
      score: scoreFn,
      swap: swaps.fn,
      dryRun: false,
    });

    expect(result.days[0]?.kind).toBe('kept-default');
    expect(swaps.calls).toHaveLength(0);
  });

  test('all-red day keeps the (red) default rather than swapping red→red', async () => {
    scoreByName.Default = 'red';
    scoreByName.AlsoRed = 'red';
    const day = dayWithDefault(1, 100, 5, 'piece-uuid');
    const menus = [
      makeMenu(100, 'A', [{ id: 5, name: 'Default' }]),
      makeMenu(200, 'B', [{ id: 6, name: 'AlsoRed' }]),
    ];
    const swaps = swapsFor();

    const result = await pickWeek({
      from: '2026-05-04',
      days: [day],
      alternativesFor: makeAlternativesFn(menus),
      score: scoreFn,
      swap: swaps.fn,
      dryRun: false,
    });

    expect(result.days[0]?.kind).toBe('kept-default');
    expect(swaps.calls).toHaveLength(0);
  });

  test('one day failing does not block other days', async () => {
    scoreByName.Default = 'red';
    scoreByName.Better = 'green';
    const failingDay = dayWithDefault(1, 100, 5, 'piece-1', '2026-05-07T12:00:00.000Z');
    const goodDay = dayWithDefault(2, 100, 5, 'piece-2', '2026-05-08T12:00:00.000Z');
    const menus = [
      makeMenu(100, 'A', [{ id: 5, name: 'Default' }]),
      makeMenu(200, 'B', [{ id: 7, name: 'Better' }]),
    ];
    const swaps = swapsFor();

    const result = await pickWeek({
      from: '2026-05-04',
      days: [failingDay, goodDay],
      alternativesFor: (() => {
        let calls = 0;
        return async () => {
          calls++;
          if (calls === 1) {
            throw new Error('transient network failure');
          }
          return menus;
        };
      })(),
      score: scoreFn,
      swap: swaps.fn,
      dryRun: false,
    });

    expect(result.days).toHaveLength(2);
    expect(result.days[0]?.kind).toBe('failed');
    expect(result.days[1]?.kind).toBe('swapped');
    expect(swaps.calls).toHaveLength(1);
  });

  test('failed scoring degrades to red; combined with non-red default = kept', async () => {
    // We never set scoreByName for these names → defaults to yellow, see scoreFn above
    scoreByName.Default = 'green';
    const day = dayWithDefault(1, 100, 5, 'piece-uuid');
    const menus = [
      makeMenu(100, 'A', [{ id: 5, name: 'Default' }]),
      makeMenu(200, 'B', [{ id: 6, name: 'NeverSeen1' }]),
      makeMenu(300, 'C', [{ id: 7, name: 'NeverSeen2' }]),
    ];
    const swaps = swapsFor();

    const result = await pickWeek({
      from: '2026-05-04',
      days: [day],
      alternativesFor: makeAlternativesFn(menus),
      score: scoreFn,
      swap: swaps.fn,
      dryRun: false,
    });

    expect(result.days[0]?.kind).toBe('kept-default');
    expect(swaps.calls).toHaveLength(0);
  });
});
