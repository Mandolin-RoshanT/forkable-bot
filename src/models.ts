// Domain types for the picker — independent of Forkable's wire schema and
// the LLM's response shape, so refactoring either doesn't ripple into core
// logic. Each schema here is paired with a Zod parser so we can validate
// untrusted inputs (e.g. the LLM's JSON output) at runtime.

import { z } from 'zod';

// ─── Scoring ──────────────────────────────────────────────────────────────

export const BucketSchema = z.enum(['green', 'yellow', 'red']);
export type Bucket = z.infer<typeof BucketSchema>;

// Higher = better. The picker uses this to find each day's top bucket;
// CLI printing uses it (descending) to sort scored alternatives so green
// comes first.
export const BUCKET_RANK: Record<Bucket, number> = { red: 0, yellow: 1, green: 2 };

export const ScoreSchema = z.object({
  bucket: BucketSchema,
  reasoning: z.string(),
});
export type Score = z.infer<typeof ScoreSchema>;

// What we hand to the scorer. Slim view of a Forkable Item — the picker
// extracts these fields from src/schemas/forkable.Item before scoring.
export type MealCandidate = {
  name: string;
  description: string | null;
  price: number | null;
  ingredientTags: string[];
  dietLevel: number | null;
};

// ─── Picker results ───────────────────────────────────────────────────────

export type SimpleMeal = {
  venue: string;
  name: string;
  price: number | null;
};

// One day's outcome. Discriminated union — easy to print and easy to test.
export type DayResult =
  | {
      kind: 'swapped';
      date: string;
      from: SimpleMeal;
      to: SimpleMeal;
      bucket: Bucket;
      reasoning: string;
    }
  | { kind: 'kept-default'; date: string; current: SimpleMeal; bucket: Bucket; reason: string }
  | { kind: 'no-default'; date: string; picked?: SimpleMeal; reason: string }
  | { kind: 'skipped-locked'; date: string }
  | { kind: 'failed'; date: string; reason: string };

export type WeekResult = {
  from: string;
  days: DayResult[];
};
