// Shared Settings literal for ForkableClient integration tests. Each
// split test file (forkable.happy-paths / forkable.errors / forkable.timeouts)
// imports this so the shape doesn't get duplicated three times.

import type { Settings } from '../../src/config.ts';

export const baseSettings: Settings = {
  forkable: { email: 'test@example.com', password: 'pw', timeoutMs: 30_000 },
  openaiApiKey: 'unused',
  resend: { apiKey: 'unused', notifyTo: 'a@b.com', notifyFrom: 'b@c.com', timeoutMs: 10_000 },
  debug: false,
};
