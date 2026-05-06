// Forkable session bootstrap: warmup → createSession → me.

import { BROWSER_HEADERS, FORKABLE_GRAPHQL } from './constants.ts';
import { applySetCookies } from './cookies.ts';
import { graphql } from './graphql.ts';
import { log, redactCookie } from './logging.ts';
import { CREATE_SESSION_MUTATION, ME_QUERY } from './queries.ts';
import type { CookieJar, ForkableUser } from './types.ts';

type CreateSessionData = {
  createSession: {
    user: ForkableUser | null;
    errorAttributes: unknown;
    errorDetails: unknown;
  };
};

type MeData = { me: ForkableUser | null };

// Anonymous POST → expected 401, seeds AWS ALB sticky-session cookies.
// Doesn't go through graphql() because that throws on non-2xx.
export async function warmup(jar: CookieJar): Promise<void> {
  const cookiesBefore = jar.size;

  const res = await fetch(FORKABLE_GRAPHQL, {
    method: 'POST',
    headers: BROWSER_HEADERS,
    body: JSON.stringify({ query: '{__typename}' }),
  });
  await res.text();
  applySetCookies(jar, res.headers);

  const captured = jar.size - cookiesBefore;
  const plural = captured === 1 ? '' : 's';
  log(
    `warmup POST ${FORKABLE_GRAPHQL} → ${res.status} (${captured} sticky cookie${plural} captured)`,
  );
}

// Prefer "*session*" cookies (e.g. _easyorder_session); fall back to first.
export function pickSessionCookieName(jar: CookieJar): string | undefined {
  const names = [...jar.keys()];
  for (const name of names) {
    if (name.toLowerCase().includes('session')) {
      return name;
    }
  }
  return names[0];
}

export async function login(
  email: string,
  password: string,
  jar: CookieJar,
): Promise<ForkableUser> {
  await warmup(jar);

  // The SPA's identities lookup hits /public/graphql which corrupts our
  // ALB cookie — skip it and go straight to createSession.
  const loginRes = await graphql<CreateSessionData>(
    FORKABLE_GRAPHQL,
    {
      operationName: 'CreateSession',
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

  return session.user;
}

// Sanity-check that the session cookie is accepted.
export async function verifyMe(jar: CookieJar): Promise<ForkableUser> {
  const res = await graphql<MeData>(FORKABLE_GRAPHQL, { query: ME_QUERY }, jar);

  if (res.errors && res.errors.length > 0) {
    throw new Error(`me query errors: ${JSON.stringify(res.errors)}`);
  }
  if (!res.data || !res.data.me) {
    throw new Error('me returned null — session cookie not accepted');
  }
  log(`me → ok (user ${res.data.me.id})`);
  return res.data.me;
}
