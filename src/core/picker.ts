// Pure picker. Given a week of deliveries and three I/O callables (fetch
// alternatives, score, swap), decides what to do for each editable day.
// No client knowledge here — easy to test with synthetic data.

import {
  BUCKET_RANK,
  type Bucket,
  type DayResult,
  type MealCandidate,
  type Score,
  type SimpleMeal,
  type WeekResult,
} from '../models.ts';
import type { Delivery, Item, Menu } from '../schemas/forkable.ts';
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
      result = { kind: 'failed', date, reason: (err as Error).message };
    }

    if (result.kind === 'swapped') {
      picksThisWeek.push({ venue: result.to.venue });
    } else if (result.kind === 'kept-default') {
      picksThisWeek.push({ venue: result.current.venue });
    } else if (result.kind === 'no-default' && result.picked) {
      picksThisWeek.push({ venue: result.picked.venue });
    }
    results.push(result);
  }

  return { from: args.from, days: results };
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

  const menus = await args.alternativesFor(day.id, day.availableMenuIds, day.club.id);
  const allItems = flattenItems(menus);
  if (allItems.length === 0) {
    return { kind: 'failed', date, reason: 'no alternative items returned' };
  }

  const scored = await Promise.all(
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

  const currentRef = currentPieceRef(day);
  const currentCandidate = currentRef
    ? scored.find((c) => c.menuId === currentRef.menuId && c.itemId === currentRef.itemId)
    : undefined;

  const bestBucket = scored.reduce<Bucket>(
    (best, c) => (BUCKET_RANK[c.bucket] > BUCKET_RANK[best] ? c.bucket : best),
    'red',
  );

  // No current default — pick the best candidate outright.
  if (!currentCandidate) {
    const topBucket = scored.filter((c) => c.bucket === bestBucket);
    const winner = breakTie(topBucket, picksThisWeek);
    if (currentRef && !args.dryRun) {
      await args.swap({
        deliveryId: day.id,
        oldPieceId: currentRef.oldPieceId,
        menuId: winner.menuId,
        itemId: winner.itemId,
      });
    }
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

  if (!args.dryRun && currentRef) {
    await args.swap({
      deliveryId: day.id,
      oldPieceId: currentRef.oldPieceId,
      menuId: winner.menuId,
      itemId: winner.itemId,
    });
  }

  return {
    kind: 'swapped',
    date,
    from: simpleMeal(currentCandidate),
    to: simpleMeal(winner),
    bucket: winner.bucket,
    reasoning: winner.reasoning,
  };
}

// ─── small helpers ─────────────────────────────────────────────────────────

type FlatItem = { menuName: string; menuId: number; item: Item };

function flattenItems(menus: Menu[]): FlatItem[] {
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

function currentPieceRef(
  day: Delivery,
): { menuId: number; itemId: number; oldPieceId: string } | undefined {
  for (const order of day.orders) {
    const piece = order.pieces[0];
    if (piece) {
      return { menuId: piece.menuId, itemId: piece.itemId, oldPieceId: piece.id };
    }
  }
  return undefined;
}

export function toCandidate(item: Item): MealCandidate {
  return {
    name: item.name,
    description: item.description,
    price: item.price,
    ingredientTags: item.ingredientTags,
    dietLevel: item.dietLevel,
  };
}

function simpleMeal(c: TiebreakCandidate): SimpleMeal {
  return { venue: c.venue, name: c.name, price: c.price };
}
