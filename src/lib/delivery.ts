// Tiny helpers for navigating a Delivery's nested order/piece structure.

import type { Delivery } from '../schemas/forkable.ts';

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
