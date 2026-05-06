# Forkable helper — known cleanup & improvements

Living list. Items here are deliberately deferred, not bugs.

## Deferred cleanups

- **Migrate `scripts/lib/auth.ts` to `ForkableClient`.** The spike's
  `warmup`/`login`/`verifyMe` were copied into `src/clients/forkable.ts`
  during M2 step 3. The spike scripts (capture-ops, probe, introspect)
  still use the old `scripts/lib/auth.ts`. To unify, expose a generic
  `client.query<T>(body)` escape hatch on `ForkableClient` and have the
  spike scripts use it. Then delete `scripts/lib/{auth,cookies,graphql,types}.ts`.
- **Logger prefix split.** `scripts/lib/logging.ts` uses `[capture-ops]`,
  `src/logger.ts` uses `[forkable-bot]`. Intentional today (different
  contexts) but if we unify spike + production code paths, decide on one.
- **`SPIKE_FINDINGS.md` lifecycle.** Mostly historical now that M2 is
  underway. Keep through M4 for traceability, then move to `docs/` or
  archive.

## Deferred improvements

- **MSW handler fixtures.** The handlers in
  `tests/integration/forkable.test.ts` are inline. If we add many more,
  extract to `tests/fixtures/msw-handlers.ts`.
- **Test the `replacePiece` swap mutation.** The captured `swap-meal.json`
  is parsed by the schema test, but no MSW test covers a successful swap
  (because `ForkableClient` doesn't have a `swapMeal()` method yet —
  comes in M3).
- **Inject the GraphQL URL into `ForkableClient`.** Currently hard-coded
  in `src/lib/constants.ts`. For mock-server tests on a different host
  we'd want a constructor option. Not urgent.
- **`noRestrictedImports` core/clients rule.** `biome.json` has the
  rule scaffolded; once `src/core/` exists (M2 step 5+), verify it
  fires.
- **Settings injection for the spike.** Several scripts need a stubbed
  `Settings` to use `loadSettings()`. Could simplify by giving
  `loadSettings` a `partial: true` mode for utilities, OR by exposing
  smaller setting-shapes for the parts they need.
