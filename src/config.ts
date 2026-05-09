// Zod-validated settings loaded from environment variables.
// Fails loudly with a clear error message if anything required is missing.

import { z } from 'zod';

// Discriminated union — exactly one provider config is active per run, and
// Zod requires the matching apiKey for whichever provider was chosen.
const ScorerConfigSchema = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('openai'), apiKey: z.string().min(1) }),
  z.object({ provider: z.literal('anthropic'), apiKey: z.string().min(1) }),
]);

const SettingsSchema = z.object({
  forkable: z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
  scorer: ScorerConfigSchema,
  resend: z.object({
    apiKey: z.string().min(1),
    notifyTo: z.string().email(),
    // Defaults to Resend's universally-verified sender. Override via
    // NOTIFY_FROM_EMAIL when you have a verified custom domain.
    notifyFrom: z.string().email().default('onboarding@resend.dev'),
  }),
  debug: z.boolean(),
});

export type Settings = z.infer<typeof SettingsSchema>;

export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  // Default to OpenAI for backward compatibility — existing deploys
  // without SCORER_PROVIDER set keep working unchanged. `||` handles
  // the empty-string case too (CI commonly passes "" for unset vars).
  const provider = env.SCORER_PROVIDER || 'openai';
  const apiKey = provider === 'anthropic' ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY;

  const result = SettingsSchema.safeParse({
    forkable: {
      email: env.FORKABLE_EMAIL,
      password: env.FORKABLE_PASSWORD,
    },
    scorer: { provider, apiKey },
    resend: {
      apiKey: env.RESEND_API_KEY,
      notifyTo: env.NOTIFY_TO_EMAIL,
      // Empty-string → undefined so the schema default kicks in (Bun
      // loads `.env` literally, so `NOTIFY_FROM_EMAIL=` is a real "").
      notifyFrom: env.NOTIFY_FROM_EMAIL || undefined,
    },
    debug: env.DEBUG === '1',
  });

  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }

  return result.data;
}
