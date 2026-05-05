/**
 * M1 spike: verify Forkable login and capture GraphQL operation responses.
 *
 *   bun run spike            # login + me + replay queries from captures/raw/
 *   bun run spike --mutate   # also replay mutations (DESTRUCTIVE — swaps real meals)
 *
 * See scripts/CAPTURE.md for the DevTools protocol.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Constants ──────────────────────────────────────────────────────────────

const FORKABLE_GRAPHQL = 'https://forkable.com/api/v2/graphql';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CAPTURES_DIR = resolve(SCRIPT_DIR, 'captures');
const RAW_DIR = resolve(CAPTURES_DIR, 'raw');

// ─── Types ──────────────────────────────────────────────────────────────────

type GraphQLBody = {
  operationName?: string;
  query: string;
  variables?: Record<string, unknown>;
};

type GraphQLResponse<T = unknown> = {
  data?: T;
  errors?: Array<{ message: string; path?: string[] }>;
};

type CookieJar = Map<string, string>;

// ─── Logging with redaction ─────────────────────────────────────────────────

function log(msg: string): void {
  console.log(`[capture-ops] ${msg}`);
}

function redactCookie(value: string): string {
  return `<${value.length} chars, prefix: ${value.slice(0, 4)}>`;
}

function redactEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!user || !domain) return '<invalid email>';
  return `${user[0]}***@${domain}`;
}

// ─── Cookie jar ─────────────────────────────────────────────────────────────

function parseSetCookies(headers: Headers): Array<{ name: string; value: string }> {
  // Bun + Node 18+ both support getSetCookie()
  const setCookies =
    (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  return setCookies
    .map((raw) => {
      const firstPair = raw.split(';')[0]?.trim();
      if (!firstPair) return null;
      const eqIdx = firstPair.indexOf('=');
      if (eqIdx <= 0) return null;
      return {
        name: firstPair.slice(0, eqIdx),
        value: firstPair.slice(eqIdx + 1),
      };
    })
    .filter((c): c is { name: string; value: string } => c !== null);
}

function applySetCookies(jar: CookieJar, headers: Headers): void {
  for (const { name, value } of parseSetCookies(headers)) {
    jar.set(name, value);
  }
}

function cookieHeader(jar: CookieJar): string | undefined {
  if (jar.size === 0) return undefined;
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

// ─── GraphQL client ─────────────────────────────────────────────────────────

async function graphql<T = unknown>(
  url: string,
  body: GraphQLBody,
  jar: CookieJar,
): Promise<GraphQLResponse<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Origin: 'https://forkable.com',
    Referer: 'https://forkable.com/mc/',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  };
  const cookie = cookieHeader(jar);
  if (cookie) headers.Cookie = cookie;

  if (process.env.DEBUG === '1') {
    log(`  → POST ${url} (cookies: ${[...jar.keys()].join(', ') || 'none'})`);
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  applySetCookies(jar, res.headers);
  const text = await res.text();

  if (process.env.DEBUG === '1') {
    log(`  ← ${res.status} ${res.statusText} (${text.length}B)`);
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} from ${url}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text) as GraphQLResponse<T>;
}

// ─── Auth flow (PRD §7.1) ───────────────────────────────────────────────────

// IMPORTANT: keep this on a single line. The Forkable edge (AWS ALB +
// Phusion Passenger) returns 401 for createSession requests whose `query`
// field starts with leading whitespace/newlines from a template literal.
// Reproduced repeatedly during the M1 spike — single-line works, multi-line
// 401s with the same cookies/headers/variables.
const CREATE_SESSION_MUTATION =
  'mutation createSession($input: CreateSessionInput!) { createSession(input: $input) { user { id email mfaEnabled } errorAttributes errorDetails } }';

const ME_QUERY = 'query me { me { id email mfaEnabled } }';

type CreateSessionData = {
  createSession: {
    user: { id: string; email: string; mfaEnabled: boolean } | null;
    errorAttributes: unknown;
    errorDetails: unknown;
  };
};

type MeData = { me: { id: string; email: string; mfaEnabled: boolean } | null };

async function warmup(jar: CookieJar): Promise<void> {
  // /api/v2/graphql is fronted by an AWS load balancer with sticky-session
  // cookies (AWSALBTG/AWSALBTGCORS) per target group. Cookies set by /mc/
  // point to a different target group than the API server expects, so an
  // anonymous POST to /api/v2/graphql returns 401 — but in the same response
  // helpfully sets *fresh* cookies for the API target group. We discard the
  // 401, keep those cookies, and proceed.
  const res = await fetch('https://forkable.com/api/v2/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Origin: 'https://forkable.com',
      Referer: 'https://forkable.com/mc/',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
    body: JSON.stringify({ query: '{__typename}' }),
  });
  // Drain body so the connection is reusable.
  await res.text();
  applySetCookies(jar, res.headers);
  log(
    `warmup POST /api/v2/graphql → ${res.status} (${jar.size} sticky cookie${jar.size === 1 ? '' : 's'} captured)`,
  );
}

async function login(email: string, password: string, jar: CookieJar): Promise<string> {
  // Step 0: warmup — acquire AWS load-balancer sticky-session cookies for the
  // /api/v2/graphql target group. Without these, /api/v2/graphql returns 401.
  await warmup(jar);

  // Step 1 (skipped): identities lookup. The SPA does this against
  // /public/graphql, but that endpoint sits on a different load-balancer
  // target group and overwrites our AWSALBTG cookie with one that
  // /api/v2/graphql will reject. Skipping it preserves the auth-endpoint
  // cookie and goes straight to login.

  // Step 2: createSession on the authenticated endpoint.
  const loginRes = await graphql<CreateSessionData>(
    FORKABLE_GRAPHQL,
    {
      operationName: 'createSession',
      query: CREATE_SESSION_MUTATION,
      variables: { input: { email, password } },
    },
    jar,
  );

  if (loginRes.errors?.length) {
    throw new Error(`createSession GraphQL errors: ${JSON.stringify(loginRes.errors)}`);
  }
  const session = loginRes.data?.createSession;
  if (!session?.user) {
    throw new Error(
      `createSession returned no user. errorAttributes=${JSON.stringify(session?.errorAttributes)} errorDetails=${JSON.stringify(session?.errorDetails)}`,
    );
  }
  if (session.user.mfaEnabled) {
    throw new Error('MFA is enabled on this account — bot cannot proceed (PRD §7.1).');
  }
  log(`createSession → ok (user ${session.user.id}, mfa: false)`);

  // Surface the cookie we picked up
  const sessionCookieName =
    [...jar.keys()].find((k) => k.toLowerCase().includes('session')) ?? [...jar.keys()][0];
  if (sessionCookieName) {
    log(`cookie attached: ${sessionCookieName}=${redactCookie(jar.get(sessionCookieName) ?? '')}`);
  } else {
    throw new Error('createSession returned no Set-Cookie — auth flow broken');
  }

  return session.user.id;
}

async function verifyMe(jar: CookieJar): Promise<void> {
  const res = await graphql<MeData>(FORKABLE_GRAPHQL, { query: ME_QUERY }, jar);
  if (res.errors?.length) {
    throw new Error(`me query errors: ${JSON.stringify(res.errors)}`);
  }
  if (!res.data?.me) {
    throw new Error('me returned null — session cookie not accepted');
  }
  log(`me → ok (user ${res.data.me.id})`);
}

// ─── Capture replay ─────────────────────────────────────────────────────────

function isMutation(query: string): boolean {
  return /^\s*mutation[\s({]/.test(query);
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

  const queries: Array<{ file: string; body: GraphQLBody }> = [];
  const mutations: Array<{ file: string; body: GraphQLBody }> = [];

  for (const file of files) {
    const path = join(RAW_DIR, file);
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch (err) {
      log(`  ${file} → SKIP (read error: ${(err as Error).message})`);
      continue;
    }
    let body: GraphQLBody;
    try {
      body = JSON.parse(raw) as GraphQLBody;
    } catch (err) {
      log(`  ${file} → SKIP (invalid JSON: ${(err as Error).message})`);
      continue;
    }
    if (typeof body.query !== 'string') {
      log(`  ${file} → SKIP (no .query string)`);
      continue;
    }
    (isMutation(body.query) ? mutations : queries).push({ file, body });
  }

  log(`replaying ${queries.length} query operation(s) from scripts/captures/raw/`);
  for (const { file, body } of queries) {
    await replayOne(file, body, jar);
  }

  if (mutations.length > 0) {
    if (allowMutations) {
      log(`replaying ${mutations.length} mutation(s) — DESTRUCTIVE, --mutate flag set`);
      for (const { file, body } of mutations) {
        await replayOne(file, body, jar);
      }
    } else {
      log(
        `skipped ${mutations.length} mutation(s) (use --mutate to replay): ${mutations.map((m) => basename(m.file, '.json')).join(', ')}`,
      );
    }
  }
}

async function replayOne(file: string, body: GraphQLBody, jar: CookieJar): Promise<void> {
  const opName = basename(file, '.json');
  try {
    const res = await graphql(FORKABLE_GRAPHQL, body, jar);
    const outPath = join(CAPTURES_DIR, `${opName}.json`);
    const json = JSON.stringify(res, null, 2);
    writeFileSync(outPath, json);
    if (res.errors?.length) {
      log(`  ${opName} → GraphQL errors: ${JSON.stringify(res.errors).slice(0, 200)}`);
    } else {
      log(
        `  ${opName} → ok, ${(json.length / 1024).toFixed(1)}KB → scripts/captures/${opName}.json`,
      );
    }
  } catch (err) {
    log(`  ${opName} → FAILED: ${(err as Error).message}`);
  }
}

// ─── Entry ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const allowMutations = process.argv.includes('--mutate');

  const email = process.env.FORKABLE_EMAIL;
  const password = process.env.FORKABLE_PASSWORD;

  if (!email || !password) {
    console.error(
      '[capture-ops] FORKABLE_EMAIL and FORKABLE_PASSWORD must be set in .env (Bun loads it automatically).',
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
  console.error(`[capture-ops] FAILED: ${err.message}`);
  process.exit(1);
});
