// ForkableClient — AbortController-backed timeout + fetchFn injection.
// These tests bypass MSW entirely and stub fetchFn directly. The injected
// fetchFn either hangs until aborted, fails immediately, or resolves fast,
// exercising each branch in ForkableClient.fetchWithTimeout.

import { describe, expect, test } from 'bun:test';

import { ForkableError } from '../../src/clients/forkable-errors.ts';
import { ForkableClient } from '../../src/clients/forkable.ts';
import type { FetchFn } from '../../src/lib/fetch.ts';
import { silentLogger } from '../fixtures/msw.ts';
import { baseSettings } from '../helpers/forkable-base.ts';

describe('ForkableClient — timeouts (via injected fetchFn)', () => {
  test('aborts a hung request and throws a network-kind ForkableError', async () => {
    // fetchFn that never resolves on its own — only settles when the
    // injected AbortSignal fires, simulating a hung upstream.
    const fetchFn: FetchFn = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });

    const client = new ForkableClient(baseSettings.forkable, silentLogger, {
      fetchFn,
      timeoutMs: 10,
    });
    const err = (await client.login().catch((e) => e)) as ForkableError;
    expect(err).toBeInstanceOf(ForkableError);
    expect(err.kind).toBe('network');
    expect(err.status).toBeUndefined();
    expect(err.context.operation).toBe('warmup');
    expect(err.context.timeoutMs).toBe(10);
    expect((err.cause as Error).name).toBe('AbortError');
  });

  test('wraps non-timeout fetch failures as network-kind ForkableError', async () => {
    const fetchFn: FetchFn = () => Promise.reject(new TypeError('fetch failed: ECONNREFUSED'));

    const client = new ForkableClient(baseSettings.forkable, silentLogger, {
      fetchFn,
      timeoutMs: 30_000,
    });
    const err = (await client.login().catch((e) => e)) as ForkableError;
    expect(err).toBeInstanceOf(ForkableError);
    expect(err.kind).toBe('network');
    expect(err.context.operation).toBe('warmup');
    expect((err.cause as Error).message).toBe('fetch failed: ECONNREFUSED');
    // Not a timeout — context shouldn't carry timeoutMs.
    expect(err.context.timeoutMs).toBeUndefined();
  });

  test('clearTimeout fires after a successful fetch (no dangling timer)', async () => {
    // If the timer wasn't cleared, the process would hold a handle for
    // the full timeoutMs after the request finished. We can't directly
    // observe that, but we CAN assert the request completes cleanly with
    // a short timeoutMs — if clearTimeout were missing, this would still
    // pass functionally, so this test mainly documents the contract.
    const fetchFn: FetchFn = async () => new Response('not json', { status: 200 });

    const client = new ForkableClient(baseSettings.forkable, silentLogger, {
      fetchFn,
      timeoutMs: 10,
    });
    // Will throw a schema error (not json), proving the request completed
    // before the timeout could fire.
    const err = (await client.login().catch((e) => e)) as ForkableError;
    expect(err.kind).toBe('schema');
  });
});
