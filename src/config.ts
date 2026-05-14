// Zod-validated settings loaded from environment variables.
// Fails loudly with a clear error message if anything required is missing.

import { z } from 'zod';

// ─── Tunables (override via env) ──────────────────────────────────────────
// Cap on every Forkable HTTP call. Aborted via AbortController so the
// in-flight request is actually cancelled when the timeout fires.
export const DEFAULT_FORKABLE_TIMEOUT_MS = 30_000;

// Cap on every Resend HTTP call. Smaller — failure-email is a follow-up
// to a primary failure, so we don't want it to hold up the cron either.
export const DEFAULT_RESEND_TIMEOUT_MS = 10_000;

// Resend's universally-verified sender. Override via NOTIFY_FROM_EMAIL
// only when you have a verified custom domain.
export const DEFAULT_RESEND_FROM = 'onboarding@resend.dev';

// ─── Schema ───────────────────────────────────────────────────────────────

const SettingsSchema = z.object({
  forkable: z.object({
    email: z.string().email(),
    password: z.string().min(1),
    timeoutMs: z.coerce.number().int().positive().default(DEFAULT_FORKABLE_TIMEOUT_MS),
  }),
  openaiApiKey: z.string().min(1),
  resend: z.object({
    apiKey: z.string().min(1),
    notifyTo: z.string().email(),
    notifyFrom: z.string().email().default(DEFAULT_RESEND_FROM),
    timeoutMs: z.coerce.number().int().positive().default(DEFAULT_RESEND_TIMEOUT_MS),
  }),
  debug: z.boolean(),
});

export type Settings = z.infer<typeof SettingsSchema>;

export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  const result = SettingsSchema.safeParse({
    forkable: {
      email: env.FORKABLE_EMAIL,
      password: env.FORKABLE_PASSWORD,
      timeoutMs: env.FORKABLE_TIMEOUT_MS || undefined,
    },
    openaiApiKey: env.OPENAI_API_KEY,
    resend: {
      apiKey: env.RESEND_API_KEY,
      notifyTo: env.NOTIFY_TO_EMAIL,
      // Empty-string → undefined so the schema default kicks in (Bun
      // loads `.env` literally, so `NOTIFY_FROM_EMAIL=` is a real "").
      notifyFrom: env.NOTIFY_FROM_EMAIL || undefined,
      timeoutMs: env.RESEND_TIMEOUT_MS || undefined,
    },
    debug: env.DEBUG === '1',
  });

  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }

  return result.data;
}
