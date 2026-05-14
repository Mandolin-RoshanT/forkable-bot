// Pure picker. Given a week of deliveries and three I/O callables (fetch
// alternatives, score, swap), decides what to do for each editable day.
// No client knowledge here — easy to test with synthetic data.

import { firstPieceWithVenue } from '../lib/delivery.ts';
import { errorMessage } from '../lib/error-message.ts';
import { flattenItems } from '../lib/menus.ts';
import {
  BUCKET_RANK,
  type Bucket,
  type DayResult,
  type MealCandidate,
  type Score,
  type SimpleMeal,
  type WeekResult,
  toCandidate,
} from '../models.ts';
import type { Delivery, Menu } from '../schemas/forkable.ts';
import { type TiebreakCandidate, breakTie } from './tiebreak.ts';

export type AlternativesFn = (
  deliveryId: number,
  menuIds: number[],
  clubId: number,
) => Promise<Menu[]>;

export type ScoreFn = (candidate: MealCandidate) => Promise<Score>;

export type SwapFn = (input: {
  deliveryId: number;
  oldPieceId: string;
  menuId: number;
  itemId: number;
}) => Promise<void>;

export type PickWeekArgs = {
  from: string;
  days: Delivery[];
  alternativesFor: AlternativesFn;
  score: ScoreFn;
  swap: SwapFn;
  dryRun: boolean;
};

type CurrentPieceRef = { menuId: number; itemId: number; oldPieceId: string };

export async function pickWeek(args: PickWeekArgs): Promise<WeekResult> {
  const results: DayResult[] = [];
  // Track venues we've committed to (swap target or kept default) so the
  // tiebreak can prefer venue variety across the week.
  const picksThisWeek: { venue: string }[] = [];

  for (const day of args.days) {
    const date = day.forDeliveryAt.slice(0, 10);

    if (day.isReadOnly) {
      results.push({ kind: 'skipped-locked', date });
      continue;
    }

    let result: DayResult;
    try {
      result = await pickOneDay(day, args, picksThisWeek);
    } catch (err) {
      result = { kind: 'failed', date, reason: errorMessage(err) };
    }

    const venue = committedVenue(result);
    if (venue) {
      picksThisWeek.push({ venue });
    }
    results.push(result);
  }

  return { from: args.from, days: results };
}

// Which venue did we commit to on this day, if any? Feeds the next day's
// tiebreak so the week prefers venue variety.
function committedVenue(result: DayResult): string | null {
  switch (result.kind) {
    case 'swapped':
      return result.to.venue;
    case 'kept-default':
      return result.current.venue;
    case 'no-default':
      return result.picked?.venue ?? null;
    case 'skipped-locked':
    case 'failed':
      return null;
  }
}

// ─── one day ───────────────────────────────────────────────────────────────

async function pickOneDay(
  day: Delivery,
  args: PickWeekArgs,
  picksThisWeek: { venue: string }[],
): Promise<DayResult> {
  const date = day.forDeliveryAt.slice(0, 10);

  if (!day.club) {
    return { kind: 'failed', date, reason: 'no club id on delivery' };
  }

  const scored = await scoreAlternatives(day, day.club.id, args);
  if (scored.length === 0) {
    return { kind: 'failed', date, reason: 'no alternative items returned' };
  }

  const currentRef = currentPieceRef(day);
  const currentCandidate = currentRef
    ? scored.find((c) => c.menuId === currentRef.menuId && c.itemId === currentRef.itemId)
    : undefined;
  const bestBucket = findBestBucket(scored);

  // No current default — pick the best candidate outright.
  if (!currentCandidate) {
    const topBucket = scored.filter((c) => c.bucket === bestBucket);
    const winner = breakTie(topBucket, picksThisWeek);
    await runSwap(args, day, currentRef, winner);
    return {
      kind: 'no-default',
      date,
      picked: simpleMeal(winner),
      reason: 'day had no current piece; picked best alternative',
    };
  }

  // Current already in the top bucket → keep default (idempotent re-runs).
  if (currentCandidate.bucket === bestBucket) {
    return {
      kind: 'kept-default',
      date,
      current: simpleMeal(currentCandidate),
      bucket: currentCandidate.bucket,
      reason: `default already in ${currentCandidate.bucket} bucket`,
    };
  }

  // Otherwise: swap to the best non-default candidate in the top bucket.
  const candidates = scored.filter(
    (c) =>
      c.bucket === bestBucket &&
      !(c.menuId === currentCandidate.menuId && c.itemId === currentCandidate.itemId),
  );
  const winner = breakTie(candidates, picksThisWeek);
  await runSwap(args, day, currentRef, winner);
  return {
    kind: 'swapped',
    date,
    from: simpleMeal(currentCandidate),
    to: simpleMeal(winner),
    bucket: winner.bucket,
    reasoning: winner.reasoning,
  };
}

// Fetch every alternative for the day and score each one. The result is a
// flat list of candidates ready for bucket-filtering and tiebreaking.
async function scoreAlternatives(
  day: Delivery,
  clubId: number,
  args: PickWeekArgs,
): Promise<TiebreakCandidate[]> {
  const menus = await args.alternativesFor(day.id, day.availableMenuIds, clubId);
  const allItems = flattenItems(menus);
  return Promise.all(
    allItems.map(async ({ menuName, menuId, item }): Promise<TiebreakCandidate> => {
      const score = await args.score(toCandidate(item));
      return {
        menuId,
        itemId: item.id,
        venue: menuName,
        name: item.name,
        price: item.price,
        bucket: score.bucket,
        reasoning: score.reasoning,
      };
    }),
  );
}

// Highest-ranked bucket present in the candidate list (red < yellow < green).
function findBestBucket(scored: TiebreakCandidate[]): Bucket {
  return scored.reduce<Bucket>(
    (best, c) => (BUCKET_RANK[c.bucket] > BUCKET_RANK[best] ? c.bucket : best),
    'red',
  );
}

// Issue the swap RPC, unless we're in dry-run or the day has no current
// piece to swap from (currentRef is what carries the oldPieceId).
async function runSwap(
  args: PickWeekArgs,
  day: Delivery,
  currentRef: CurrentPieceRef | undefined,
  winner: TiebreakCandidate,
): Promise<void> {
  if (args.dryRun || !currentRef) {
    return;
  }
  await args.swap({
    deliveryId: day.id,
    oldPieceId: currentRef.oldPieceId,
    menuId: winner.menuId,
    itemId: winner.itemId,
  });
}

// ─── helpers ─────────────────────────────────────────────────────────

function currentPieceRef(day: Delivery): CurrentPieceRef | undefined {
  const fpv = firstPieceWithVenue(day);
  if (!fpv) return undefined;
  return { menuId: fpv.piece.menuId, itemId: fpv.piece.itemId, oldPieceId: fpv.piece.id };
}

function simpleMeal(c: TiebreakCandidate): SimpleMeal {
  return { venue: c.venue, name: c.name, price: c.price };
}
