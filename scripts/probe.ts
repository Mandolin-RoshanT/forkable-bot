// Probe: log in and send speculative GraphQL queries; the server's error
// messages (often "Did you mean: ...") map the schema when introspection is off.

import { ForkableClient } from '../src/clients/forkable.ts';
import { captureOpsLogger, log, logError, redactEmail } from './lib/logging.ts';
import { PROBES } from './lib/probes.ts';

async function main(): Promise<void> {
  const email = process.env.FORKABLE_EMAIL;
  const password = process.env.FORKABLE_PASSWORD;
  if (!email || !password) {
    logError('FORKABLE_EMAIL and FORKABLE_PASSWORD must be set in .env');
    process.exit(1);
  }
  log(`account: ${redactEmail(email)}`);

  const client = new ForkableClient({ email, password }, captureOpsLogger);
  await client.login();
  log('logged in, starting probes…');

  for (const probe of PROBES) {
    log(`\n--- ${probe.label} ---`);
    log(`query: ${probe.query}`);
    try {
      const res = await client.rawQuery({ query: probe.query }, probe.label);
      if (res.errors && res.errors.length > 0) {
        for (const e of res.errors) {
          log(`  ✗ ${e.message}`);
        }
      } else {
        log(`  ✓ ok: ${JSON.stringify(res.data).slice(0, 300)}`);
      }
    } catch (err) {
      log(`  ✗ HTTP error: ${(err as Error).message.slice(0, 300)}`);
    }
  }
}

main().catch((err: Error) => {
  logError(`FAILED: ${err.message}`);
  process.exit(1);
});
