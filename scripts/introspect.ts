// Log in and dump the full GraphQL schema to scripts/captures/schema.json.
// Currently exits 2 because Forkable disables introspection.
//
//   bun scripts/introspect.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { login } from './lib/auth.ts';
import { CAPTURES_DIR, FORKABLE_GRAPHQL } from './lib/constants.ts';
import { graphql } from './lib/graphql.ts';
import { log, logError, redactEmail } from './lib/logging.ts';
import { INTROSPECTION_QUERY } from './lib/queries.ts';
import type { CookieJar } from './lib/types.ts';

async function main(): Promise<void> {
  const email = process.env.FORKABLE_EMAIL;
  const password = process.env.FORKABLE_PASSWORD;
  if (!email || !password) {
    logError('FORKABLE_EMAIL and FORKABLE_PASSWORD must be set in .env');
    process.exit(1);
  }
  log(`account: ${redactEmail(email)}`);

  const jar: CookieJar = new Map();
  await login(email, password, jar);

  log('running introspection query…');
  const res = await graphql(FORKABLE_GRAPHQL, { query: INTROSPECTION_QUERY }, jar);

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
