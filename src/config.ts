// Zod-validated settings loaded from environment variables.
// Fails loudly with a clear error message if anything required is missing.

import { z } from 'zod';

export const SettingsSchema = z.object({
  forkable: z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
  openaiApiKey: z.string().min(1),
  resend: z.object({
    apiKey: z.string().min(1),
    notifyTo: z.string().email(),
    notifyFrom: z.string().email(),
  }),
  debug: z.boolean(),
});

export type Settings = z.infer<typeof SettingsSchema>;

export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  const result = SettingsSchema.safeParse({
    forkable: {
      email: env.FORKABLE_EMAIL,
      password: env.FORKABLE_PASSWORD,
    },
    openaiApiKey: env.OPENAI_API_KEY,
    resend: {
      apiKey: env.RESEND_API_KEY,
      notifyTo: env.NOTIFY_TO_EMAIL,
      notifyFrom: env.NOTIFY_FROM_EMAIL,
    },
    debug: env.DEBUG === '1',
  });

  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }

  return result.data;
}
