// Helpers for navigating Forkable's nested wire shape. Two layers:
//
//   1. Delivery → orders → pieces — the user's per-day picks. Multiple
//      "orders" exist per delivery (one per available venue) but at most
//      one carries a piece.
//   2. Menu → sections → items — the alternatives offered for a day.
//      Most callers want a flat list of items with their parent venue
//      label, not the triple-nested original.

import type { Delivery, Item, Menu } from '../schemas/forkable.ts';

type Piece = Delivery['orders'][number]['pieces'][number];

// The user's currently-chosen meal for a delivery. Returns undefined when
// no order on this delivery carries a piece (e.g. a day with no default).
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

// Flatten menus → sections → items into one array, tagging each item with
// the venue it belongs to.
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
