// Endpoint-agnostic GraphQL POST. Forkable-specific concerns (warmup, auth,
// mutation strings) live in the caller — see scripts/capture-ops.ts.

import { BROWSER_HEADERS } from './constants.ts';
import { applySetCookies, cookieHeader } from './cookies.ts';
import { logDebug } from './logging.ts';
import type { CookieJar, GraphQLBody, GraphQLResponse } from './types.ts';

export async function graphql<T = unknown>(
  url: string,
  body: GraphQLBody,
  jar: CookieJar,
): Promise<GraphQLResponse<T>> {
  // Spread = Python's `{**dict}` — copy then layer cookies on top.
  const headers: Record<string, string> = { ...BROWSER_HEADERS };
  const cookie = cookieHeader(jar);
  if (cookie) {
    headers.Cookie = cookie;
  }

  const cookieNames = [...jar.keys()].join(', ') || 'none';
  logDebug(`  → POST ${url} (cookies: ${cookieNames})`);

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  applySetCookies(jar, res.headers);

  const text = await res.text();
  logDebug(`  ← ${res.status} ${res.statusText} (${text.length}B)`);

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} from ${url}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text) as GraphQLResponse<T>;
}
