import { describe, expect, test } from 'bun:test';

import { redactCookie, redactEmail } from '../../src/format.ts';

describe('redactCookie', () => {
  test('keeps length + first 4 chars', () => {
    expect(redactCookie('abcdefghij')).toBe('<10 chars, prefix: abcd>');
  });
});

describe('redactEmail', () => {
  test('masks the local part', () => {
    expect(redactEmail('user@example.com')).toBe('u***@example.com');
  });

  test('handles malformed input', () => {
    expect(redactEmail('not-an-email')).toBe('<invalid email>');
  });
});
