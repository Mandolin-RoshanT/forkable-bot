// Domain types for the picker — independent of Forkable's wire schema and
// the LLM's response shape, so refactoring either doesn't ripple into core
// logic. Each schema here is paired with a Zod parser so we can validate
// untrusted inputs (e.g. the LLM's JSON output) at runtime.

import { z } from 'zod';

// ─── Scoring ──────────────────────────────────────────────────────────────

export const BucketSchema = z.enum(['green', 'yellow', 'red']);
export type Bucket = z.infer<typeof BucketSchema>;

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
