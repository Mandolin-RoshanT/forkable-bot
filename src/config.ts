// Zod-validated settings loaded from environment variables.
// Fails loudly with a clear error message if anything required is missing.

import { z } from 'zod';

// Cap on every Forkable HTTP call (cancelled via AbortController).
export const DEFAULT_FORKABLE_TIMEOUT_MS = 30_000;

// Smaller cap on Resend: failure-email is a follow-up to a primary failure
// so it shouldn't hold up the cron either.
export const DEFAULT_RESEND_TIMEOUT_MS = 10_000;

// Resend's universally-verified sender. Override via NOTIFY_FROM_EMAIL
// only when you have a verified custom domain.
export const DEFAULT_RESEND_FROM = 'onboarding@resend.dev';

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

// Sections a caller can mark "not needed" — their required fields get
// sentinel placeholders if missing from env so read-only flows (show-week,
// verify-queries) can run without a full set of credentials.
type OptionalSection = 'openai' | 'resend';

export type LoadSettingsOptions = {
  optional?: OptionalSection[];
};

const PLACEHOLDER = {
  openaiApiKey: 'unused-placeholder',
  resendApiKey: 'unused-placeholder',
  notifyToEmail: 'noreply@example.com',
} as const;

export function loadSettings(
  env: NodeJS.ProcessEnv = process.env,
  opts: LoadSettingsOptions = {},
): Settings {
  const optional = new Set(opts.optional ?? []);

  const openaiApiKey =
    env.OPENAI_API_KEY || (optional.has('openai') ? PLACEHOLDER.openaiApiKey : undefined);
  const resendApiKey =
    env.RESEND_API_KEY || (optional.has('resend') ? PLACEHOLDER.resendApiKey : undefined);
  const notifyTo =
    env.NOTIFY_TO_EMAIL || (optional.has('resend') ? PLACEHOLDER.notifyToEmail : undefined);

  const result = SettingsSchema.safeParse({
    forkable: {
      email: env.FORKABLE_EMAIL,
      password: env.FORKABLE_PASSWORD,
      timeoutMs: env.FORKABLE_TIMEOUT_MS || undefined,
    },
    openaiApiKey,
    resend: {
      apiKey: resendApiKey,
      notifyTo,
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
