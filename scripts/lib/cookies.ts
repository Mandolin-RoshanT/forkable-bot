// Hand-rolled cookie jar — no domain/path matching needed.

import type { Cookie, CookieJar } from './types.ts';

function parseSetCookies(headers: Headers): Cookie[] {
  // Bun/Node 18 expose getSetCookie() at runtime but DOM types lag.
  const headersAny = headers as unknown as { getSetCookie?: () => string[] };
  const setCookieLines = headersAny.getSetCookie?.() ?? [];

  const cookies: Cookie[] = [];
  for (const rawLine of setCookieLines) {
    const firstPair = rawLine.split(';')[0]?.trim();
    if (!firstPair) {
      continue;
    }
    const eqIdx = firstPair.indexOf('=');
    if (eqIdx <= 0) {
      continue;
    }
    cookies.push({
      name: firstPair.slice(0, eqIdx),
      value: firstPair.slice(eqIdx + 1),
    });
  }
  return cookies;
}

export function applySetCookies(jar: CookieJar, headers: Headers): void {
  for (const { name, value } of parseSetCookies(headers)) {
    jar.set(name, value);
  }
}

export function cookieHeader(jar: CookieJar): string | undefined {
  if (jar.size === 0) {
    return undefined;
  }
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}
