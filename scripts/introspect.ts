// Log in and dump the full GraphQL schema to scripts/captures/schema.json.
// Currently exits 2 because Forkable disables introspection.
//
//   bun scripts/introspect.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ForkableClient } from '../src/clients/forkable.ts';
import { CAPTURES_DIR } from './lib/constants.ts';
import { captureOpsLogger, log, logError, redactEmail } from './lib/logging.ts';
import { INTROSPECTION_QUERY } from './lib/queries.ts';

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

  log('running introspection query…');
  const res = await client.rawQuery({ query: INTROSPECTION_QUERY }, 'IntrospectionQuery');

  if (res.errors && res.errors.length > 0) {
    logError(`introspection BLOCKED: ${JSON.stringify(res.errors)}`);
    process.exit(2);
  }

  mkdirSync(CAPTURES_DIR, { recursive: true });
  const outPath = join(CAPTURES_DIR, 'schema.json');
  writeFileSync(outPath, JSON.stringify(res, null, 2));
  const sizeKB = (JSON.stringify(res).length / 1024).toFixed(1);
  log(`schema dumped → ${outPath} (${sizeKB}KB)`);
}

main().catch((err: Error) => {
  logError(`FAILED: ${err.message}`);
  process.exit(1);
});
