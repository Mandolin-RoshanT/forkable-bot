// Shared synthetic Delivery + Menu factories for pickWeek tests. Each
// test file imports these so the same makeDelivery/makeMenu shape doesn't
// get duplicated across the split test files.

import type { ScoreFn, SwapFn } from '../../src/core/picker.ts';
import type { Bucket } from '../../src/models.ts';
import type { Delivery, Menu } from '../../src/schemas/forkable.ts';

export function makeDelivery(overrides: Partial<Delivery> & Pick<Delivery, 'id'>): Delivery {
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

export function makeMenu(
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
export function dayWithDefault(
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

// Per-file score map + scoreFn pair. Call once at the top of each test
// file so mutations during one file's tests don't leak into another file's
// runs (Bun test caches modules across files in a single run).
export function createScorer(): {
  byName: Record<string, Bucket>;
  scoreFn: ScoreFn;
} {
  const byName: Record<string, Bucket> = {};
  const scoreFn: ScoreFn = async (cand) => {
    const bucket = byName[cand.name] ?? 'yellow';
    return { bucket, reasoning: `mock: ${bucket}` };
  };
  return { byName, scoreFn };
}

export function makeAlternativesFn(menus: Menu[]) {
  return async () => menus;
}

export function createSwapRecorder(): {
  fn: SwapFn;
  calls: { deliveryId: number; menuId: number; itemId: number; oldPieceId: string }[];
} {
  const calls: { deliveryId: number; menuId: number; itemId: number; oldPieceId: string }[] = [];
  const fn: SwapFn = async (input) => {
    calls.push(input);
  };
  return { fn, calls };
}
