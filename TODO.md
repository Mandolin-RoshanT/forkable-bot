# Forkable helper — known cleanup & improvements

Living list. Items here are deliberately deferred, not bugs.

## Deferred cleanups

- **Logger prefix split.** `scripts/lib/logging.ts` uses `[capture-ops]`,
  `src/logger.ts` uses `[forkable-bot]`. Intentional today (different
  contexts). The spike's `captureOpsLogger` adapter satisfies the
  `Logger` interface so spike scripts still work with `ForkableClient`.
  Reconsider only if we collapse the contexts.

## Deferred improvements

- **MSW handler fixtures.** Handlers in the split `forkable.*.test.ts`
  files are inline. If we add many more, extract to
  `tests/fixtures/msw-handlers.ts`.
- **Inject the GraphQL URL into `ForkableClient`.** Currently hard-coded
  at the top of `src/clients/forkable.ts`. For mock-server tests on a
  different host we'd want a constructor option. Not urgent.
