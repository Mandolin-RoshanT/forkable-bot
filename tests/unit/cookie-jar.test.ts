import { describe, expect, test } from 'bun:test';

import { CookieJar } from '../../src/clients/cookie-jar.ts';

// Real Headers with Set-Cookie pairs. Using `new Headers().append()` is
// the cleanest way to populate getSetCookie() in Bun.
function headersWithCookies(...lines: string[]): Headers {
  const h = new Headers();
  for (const line of lines) h.append('Set-Cookie', line);
  return h;
}

describe('CookieJar.add', () => {
  test('parses a single Set-Cookie line into name/value', () => {
    const jar = new CookieJar();
    jar.add(headersWithCookies('session=abc123; Path=/; HttpOnly'));
    expect(jar.size).toBe(1);
    expect(jar.get('session')).toBe('abc123');
  });

  test('parses multiple Set-Cookie lines independently', () => {
    const jar = new CookieJar();
    jar.add(headersWithCookies('a=1; Path=/', 'b=2; HttpOnly', 'c=3'));
    expect(jar.names().sort()).toEqual(['a', 'b', 'c']);
  });

  test('skips malformed lines (no =, or empty)', () => {
    const jar = new CookieJar();
    jar.add(headersWithCookies('valid=ok', 'no-equals-here', '=leading-equals'));
    expect(jar.names()).toEqual(['valid']);
  });

  test('a second add() with the same name overwrites', () => {
    const jar = new CookieJar();
    jar.add(headersWithCookies('s=v1'));
    jar.add(headersWithCookies('s=v2'));
    expect(jar.get('s')).toBe('v2');
  });
});

describe('CookieJar.snapshot/diff', () => {
  test('diff against a pre-add snapshot returns the newly added names', () => {
    const jar = new CookieJar();
    jar.add(headersWithCookies('warmup=alb-ok'));
    const before = jar.snapshot();
    jar.add(headersWithCookies('session=fresh'));
    expect(jar.diff(before)).toEqual(['session']);
  });

  test('diff is empty when nothing was added since the snapshot', () => {
    const jar = new CookieJar();
    jar.add(headersWithCookies('s=v'));
    expect(jar.diff(jar.snapshot())).toEqual([]);
  });
});

describe('CookieJar.serialize', () => {
  test('joins entries with "; " for the Cookie header', () => {
    const jar = new CookieJar();
    jar.add(headersWithCookies('a=1', 'b=2'));
    expect(jar.serialize()).toBe('a=1; b=2');
  });

  test('returns undefined on an empty jar (so the request omits the header)', () => {
    expect(new CookieJar().serialize()).toBeUndefined();
  });
});
