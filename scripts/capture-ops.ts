// M1 spike: log in and replay GraphQL ops captured from DevTools.
//
//   bun run spike            # queries only
//   bun run spike --mutate   # also replay mutations (DESTRUCTIVE)
//
// See scripts/CAPTURE.md for how to capture payloads.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { login, verifyMe } from './lib/auth.ts';
import { CAPTURES_DIR, FORKABLE_GRAPHQL, RAW_DIR } from './lib/constants.ts';
import { graphql } from './lib/graphql.ts';
import { log, logError, redactEmail } from './lib/logging.ts';
import type { CapturedOp, CookieJar, GraphQLBody } from './lib/types.ts';

// ─── Capture replay ─────────────────────────────────────────────────────────

function isMutation(query: string): boolean {
  return /^\s*mutation[\s({]/.test(query);
}

async function loadCapturedOp(file: string): Promise<GraphQLBody | null> {
  const path = join(RAW_DIR, file);

  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    log(`  ${file} → SKIP (read error: ${(err as Error).message})`);
    return null;
  }

  let body: GraphQLBody;
  try {
    body = JSON.parse(raw) as GraphQLBody;
  } catch (err) {
    log(`  ${file} → SKIP (invalid JSON: ${(err as Error).message})`);
    return null;
  }

  if (typeof body.query !== 'string') {
    log(`  ${file} → SKIP (no .query string)`);
    return null;
  }
  return body;
}

async function replayCaptures(jar: CookieJar, allowMutations: boolean): Promise<void> {
  if (!existsSync(RAW_DIR)) {
    log('no scripts/captures/raw/ directory — skipping replay phase');
    return;
  }

  const files = readdirSync(RAW_DIR).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    log('no operation captures in scripts/captures/raw/, exiting');
    return;
  }

  mkdirSync(CAPTURES_DIR, { recursive: true });

  // Split queries vs mutations so mutations stay guarded behind --mutate.
  const queries: CapturedOp[] = [];
  const mutations: CapturedOp[] = [];

  for (const file of files) {
    const body = await loadCapturedOp(file);
    if (!body) {
      continue;
    }
    if (isMutation(body.query)) {
      mutations.push({ file, body });
    } else {
      queries.push({ file, body });
    }
  }

  // Run sequentially to avoid hammering the API.
  log(`replaying ${queries.length} query operation(s) from scripts/captures/raw/`);
  for (const op of queries) {
    await replayOne(op.file, op.body, jar);
  }

  if (mutations.length === 0) {
    return;
  }

  if (allowMutations) {
    log(`replaying ${mutations.length} mutation(s) — DESTRUCTIVE, --mutate flag set`);
    for (const op of mutations) {
      await replayOne(op.file, op.body, jar);
    }
  } else {
    const skippedNames = mutations.map((op) => basename(op.file, '.json')).join(', ');
    log(`skipped ${mutations.length} mutation(s) (use --mutate to replay): ${skippedNames}`);
  }
}

async function replayOne(file: string, body: GraphQLBody, jar: CookieJar): Promise<void> {
  const opName = basename(file, '.json');
  try {
    const res = await graphql(FORKABLE_GRAPHQL, body, jar);
    const outPath = join(CAPTURES_DIR, file);
    const json = JSON.stringify(res, null, 2);
    writeFileSync(outPath, json);

    if (res.errors && res.errors.length > 0) {
      const errSnippet = JSON.stringify(res.errors).slice(0, 200);
      logError(`  ${opName} → GraphQL errors: ${errSnippet}`);
    } else {
      const sizeKB = (json.length / 1024).toFixed(1);
      log(`  ${opName} → ok, ${sizeKB}KB → scripts/captures/${file}`);
    }
  } catch (err) {
    logError(`  ${opName} → FAILED: ${(err as Error).message}`);
  }
}

// ─── Entry ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const allowMutations = process.argv.includes('--mutate');

  const email = process.env.FORKABLE_EMAIL;
  const password = process.env.FORKABLE_PASSWORD;

  if (!email || !password) {
    logError(
      'FORKABLE_EMAIL and FORKABLE_PASSWORD must be set in .env (Bun loads it automatically).',
    );
    process.exit(1);
  }

  log('loading credentials from .env');
  log(`account: ${redactEmail(email)}`);

  const jar: CookieJar = new Map();

  await login(email, password, jar);
  await verifyMe(jar);
  log('login flow verified ✓');

  await replayCaptures(jar, allowMutations);
  log('done');
}

main().catch((err: Error) => {
  logError(`FAILED: ${err.message}`);
  process.exit(1);
});
