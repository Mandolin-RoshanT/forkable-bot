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
  if (candidates.length === 0) {
    throw new Error('breakTie: candidates must be non-empty');
  }
  const venuesUsed = new Set(picksThisWeek.map((p) => p.venue));

  // Stable sort by (priceAsc, freshVenueDesc).
  const ranked = candidates
    .map((c, idx) => ({ c, idx }))
    .sort((a, b) => {
      const priceDiff =
        (a.c.price ?? Number.POSITIVE_INFINITY) - (b.c.price ?? Number.POSITIVE_INFINITY);
      if (priceDiff !== 0) return priceDiff;

      const aFresh = !venuesUsed.has(a.c.venue);
      const bFresh = !venuesUsed.has(b.c.venue);
      if (aFresh && !bFresh) return -1;
      if (!aFresh && bFresh) return 1;

      return a.idx - b.idx;
    });

  const winner = ranked[0];
  if (!winner) {
    throw new Error('breakTie: ranked array is empty (unreachable)');
  }
  return winner.c;
}
