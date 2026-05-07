// Pure tiebreak logic. Caller has already filtered candidates down to a
// single bucket; we pick one.
//   1. Lower price wins.
//   2. Restaurant variety: prefer a venue not already picked this week.
// Stable: caller's order wins on a true tie.

import type { Bucket } from '../models.ts';

export type TiebreakCandidate = {
  menuId: number;
  itemId: number;
  venue: string;
  name: string;
  price: number | null;
  bucket: Bucket;
  reasoning: string;
};

export function breakTie(
  candidates: TiebreakCandidate[],
  picksThisWeek: { venue: string }[],
): TiebreakCandidate {
  const venuesUsed = new Set(picksThisWeek.map((p) => p.venue));

  // Sort a copy by (priceAsc, freshVenueDesc). Array.prototype.sort is
  // stable since ES2019, so equal entries keep their input order — the
  // implicit third tiebreaker.
  const [winner] = [...candidates].sort((a, b) => {
    const priceDiff = (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY);
    if (priceDiff !== 0) return priceDiff;

    const aFresh = !venuesUsed.has(a.venue);
    const bFresh = !venuesUsed.has(b.venue);
    if (aFresh && !bFresh) return -1;
    if (!aFresh && bFresh) return 1;

    return 0;
  });

  if (!winner) {
    throw new Error('breakTie: candidates must be non-empty');
  }
  return winner;
}
