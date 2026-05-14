// Pure shape navigation over Forkable's wire schema — flatten the nested
// orders/pieces and menus/sections/items trees in one place so callers
// can ask "what's the user's pick?" or "what items are available?" directly.

import type { Delivery, Item, Menu } from './schemas/forkable.ts';

type Piece = Delivery['orders'][number]['pieces'][number];

// The user's currently-chosen meal for a delivery. Forkable models a day
// as multiple "orders" (one per available venue), but at most one carries
// a piece — that's the user's pick.
export function firstPieceWithVenue(
  day: Delivery,
): { piece: Piece; venueName: string | undefined } | undefined {
  for (const order of day.orders) {
    const piece = order.pieces[0];
    if (piece) return { piece, venueName: order.menu?.name };
  }
  return undefined;
}

export type FlatItem = { menuName: string; menuId: number; item: Item };

export function flattenItems(menus: Menu[]): FlatItem[] {
  const out: FlatItem[] = [];
  for (const menu of menus) {
    const menuName = menu.displayName ?? menu.name;
    for (const section of menu.sections) {
      for (const item of section.items) {
        out.push({ menuName, menuId: menu.id, item });
      }
    }
  }
  return out;
}
