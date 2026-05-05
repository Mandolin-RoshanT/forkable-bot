/**
 * M1 spike: verify Forkable login and capture GraphQL operation responses.
 *
 *   bun run spike            # login + me + replay queries from captures/raw/
 *   bun run spike --mutate   # also replay mutations (DESTRUCTIVE — swaps real meals)
 *
 * See scripts/CAPTURE.md for the DevTools protocol.
 * Shared helpers live in scripts/lib/ — this file only orchestrates the
 * Forkable-specific auth flow and capture replay.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { BROWSER_HEADERS, CAPTURES_DIR, FORKABLE_GRAPHQL, RAW_DIR } from './lib/constants.ts';
import { applySetCookies } from './lib/cookies.ts';
import { graphql } from './lib/graphql.ts';
import { log, logError, redactCookie, redactEmail } from './lib/logging.ts';
import type { CapturedOp, CookieJar, ForkableUser, GraphQLBody } from './lib/types.ts';

// ─── Auth flow (PRD §7.1) ───────────────────────────────────────────────────

// IMPORTANT — must stay on one line. Forkable's edge (AWS ALB + Phusion
// Passenger) returns 401 if `query` has leading whitespace from a template
// literal. Verified during M1 spike with otherwise-identical requests.
const CREATE_SESSION_MUTATION =
  'mutation createSession($input: CreateSessionInput!) { createSession(input: $input) { user { id email mfaEnabled } errorAttributes errorDetails } }';

const ME_QUERY = 'query me { me { id email mfaEnabled } }';

type CreateSessionData = {
  createSession: {
    user: ForkableUser | null;
    errorAttributes: unknown;
    errorDetails: unknown;
  };
};

type MeData = { me: ForkableUser | null };

async function warmup(jar: CookieJar): Promise<void> {
  // Intentional 401: this seeds the ALB sticky cookies needed for later requests.
  // `graphql()` is not used here because it throws on non-2xx.
  const cookiesBefore = jar.size;

  const res = await fetch(FORKABLE_GRAPHQL, {
    method: 'POST',
    headers: BROWSER_HEADERS,
    body: JSON.stringify({ query: '{__typename}' }),
  });
  // Only Set-Cookie headers matter from this call.
  await res.text();
  applySetCookies(jar, res.headers);

  const captured = jar.size - cookiesBefore;
  const plural = captured === 1 ? '' : 's';
  log(
    `warmup POST ${FORKABLE_GRAPHQL} → ${res.status} (${captured} sticky cookie${plural} captured)`,
  );
}

function pickSessionCookieName(jar: CookieJar): string | undefined {
  // Prefer names that look session-related.
  const names = [...jar.keys()];
  for (const name of names) {
    if (name.toLowerCase().includes('session')) {
      return name;
    }
  }
  return names[0];
}

async function login(email: string, password: string, jar: CookieJar): Promise<string> {
  await warmup(jar);

  // Skip SPA's `/public/graphql` identities call; it can swap in the wrong ALB cookie.

  const loginRes = await graphql<CreateSessionData>(
    FORKABLE_GRAPHQL,
    {
      operationName: 'createSession',
      query: CREATE_SESSION_MUTATION,
      variables: { input: { email, password } },
    },
    jar,
  );

  if (loginRes.errors && loginRes.errors.length > 0) {
    throw new Error(`createSession GraphQL errors: ${JSON.stringify(loginRes.errors)}`);
  }

  const session = loginRes.data?.createSession;
  if (!session || !session.user) {
    const errAttrs = JSON.stringify(session?.errorAttributes);
    const errDetails = JSON.stringify(session?.errorDetails);
    throw new Error(
      `createSession returned no user. errorAttributes=${errAttrs} errorDetails=${errDetails}`,
    );
  }

  if (session.user.mfaEnabled) {
    throw new Error('MFA is enabled on this account — bot cannot proceed (PRD §7.1).');
  }
  log(`createSession → ok (user ${session.user.id}, mfa: false)`);

  const sessionCookieName = pickSessionCookieName(jar);
  if (!sessionCookieName) {
    throw new Error('createSession returned no Set-Cookie — auth flow broken');
  }
  const cookieValue = jar.get(sessionCookieName) ?? '';
  log(`cookie attached: ${sessionCookieName}=${redactCookie(cookieValue)}`);

  return session.user.id;
}

async function verifyMe(jar: CookieJar): Promise<void> {
  const res = await graphql<MeData>(FORKABLE_GRAPHQL, { query: ME_QUERY }, jar);

  if (res.errors && res.errors.length > 0) {
    throw new Error(`me query errors: ${JSON.stringify(res.errors)}`);
  }
  if (!res.data || !res.data.me) {
    throw new Error('me returned null — session cookie not accepted');
  }
  log(`me → ok (user ${res.data.me.id})`);
}

// ─── Capture replay ─────────────────────────────────────────────────────────

function isMutation(query: string): boolean {
  // Handles `mutation`, `mutation Foo`, and `mutation(...)`.
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
