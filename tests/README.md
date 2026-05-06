# Test suite

76 tests across 12 files (`bun test`). Three layers, three mocking strategies — each chosen to test the unit at the right level without leaking the layer below it into the test.

## Quick grid

### Unit (`tests/unit/`) — pure logic, dependency-injected fakes

| File | Module under test | What it tests | How it mocks |
|---|---|---|---|
| `config.test.ts` | `src/config.ts` | env validation, required-field errors, `NOTIFY_FROM_EMAIL` default + empty-string fallback | synthetic `env` object passed to `loadSettings(env)` |
| `logger.test.ts` | `src/logger.ts` | secret scrubbing across `info`/`error`/`debug`, `debug` gating, `error` → stderr | captured `console.log` / `console.error` |
| `openai-scorer.test.ts` | `src/clients/openai-scorer.ts` | green/red parsing, four parse-failure paths (non-JSON, wrong shape, bad enum, OpenAI throws), only relevant fields go to the LLM | injected `ChatCompleter` fake (no real OpenAI call) |
| `picker.test.ts` | `src/core/picker.ts` | locked-day skip, kept-default, swap, dry-run noop, idempotency, all-red keeps default, per-day failure isolation | synthetic `Delivery` + `Menu` factories + injected callables |
| `resend-mailer.test.ts` | `src/clients/resend-mailer.ts` | bearer-auth header, JSON body shape, throw on non-2xx, summary email format | monkey-patched `globalThis.fetch` |
| `run-log.test.ts` | `src/core/run-log.ts` | every `DayResult.kind` → row shape, RFC-4180 escaping (commas, `"`, newlines), header always emitted, `mode` column | synthetic `WeekResult` |
| `run-log-writer.test.ts` | `src/clients/run-log-writer.ts` | overwrite-on-write (vs append), parent-dir creation, no-op on empty rows | tempdir-isolated filesystem (`mkdtemp` per test) |
| `tiebreak.test.ts` | `src/core/tiebreak.ts` | empty-input throw, single candidate, price preference, venue-variety preference, stable input-order tiebreak, null-price fallback | synthetic candidates |

### Integration (`tests/integration/`) — multiple modules wired together

| File | Layers exercised | What it tests | How it mocks |
|---|---|---|---|
| `forkable.test.ts` | `ForkableClient` end-to-end | happy paths (login/me/getWeek/getAlternatives/swapMeal), auth errors, transport errors, schema errors, **`replacePiece` locked input shape** (`selectionsHash: {}`), `requireLogin` guard | MSW server + `graphqlHandler` (warmup-401 baked in) |
| `schemas.test.ts` | Zod schemas vs real captured JSON | schema-drift tripwire — every Forkable response shape we depend on parses the actual captured payloads | real captured JSON files in `scripts/captures/` |
| `e2e.test.ts` | picker + ForkableClient + Zod schemas + swap mutation | full pipeline with real captures: locked days skipped, editable day swaps to the green item, dry-run never invokes swap | MSW serving captured JSON + stub `ChatCompleter` |
| `cli-failure.test.ts` | `runPicker` → `ResendMailer` | the PRD §13 failure-email path — when login fails or network 500s, `sendFailure` actually hits Resend with the right subject/body | MSW for both `forkable.com` and `api.resend.com` + scoped env mutation |

### Fixtures (`tests/fixtures/`)

| File | Purpose |
|---|---|
| `msw.ts` | Shared MSW scaffolding: `createTestServer({ onUnhandledRequest? })` (registers lifecycle hooks for the calling file), `graphqlHandler({ ...routes })` (dispatches by `operationName`, warmup-401 baked in), `silentLogger`, `VALID_USER`, `SESSION_COOKIE_HEADERS`, response builders `createSessionOk()` / `meOk()` |

## Running tests

```sh
bun test                       # all 76 tests
bun test tests/unit/           # unit only (~50 tests)
bun test tests/integration/    # integration only (~25 tests)
bun test tests/unit/picker     # one file
bun run check                  # typecheck + lint + tests (the gate before commit)
```

Tests run sequentially per file; Bun handles file isolation. No flakiness expected — every test mocks its dependencies.

## Patterns the suite uses

- **Pure logic uses synthetic factories.** `picker.test.ts` and `tiebreak.test.ts` build minimal `Delivery` / `Menu` / `Candidate` objects in code; they never touch the wire. New pure functions in `src/core/` should follow the same pattern.
- **HTTP boundaries use MSW.** Anything that calls `fetch()` (the `ForkableClient` or anything else added later that hits a server) gets MSW handlers. The `graphqlHandler` helper makes the common case (dispatch by `operationName`) one line per route.
- **Single-method facades use monkey-patched `fetch`.** `resend-mailer.test.ts` does this — for one POST endpoint, MSW is overkill. If we add a second mailer, switch to MSW.
- **LLM-using code uses dependency injection.** `OpenAIScorer` accepts a `ChatCompleter` function; tests pass a fake. The `createOpenAIScorer({ apiKey })` factory wires the real OpenAI SDK in production.
- **Per-test isolation.** MSW resets handlers between tests (`afterEach(() => server.resetHandlers())`); the writer tests use `mkdtemp` per test; logger tests restore `console.log` in `try/finally`.

## Where new tests go

| Adding | Goes in |
|---|---|
| New pure function in `src/core/` | `tests/unit/<module>.test.ts` with synthetic data |
| New `ForkableClient` method | `tests/integration/forkable.test.ts` with an MSW route |
| New `clients/*` boundary | `tests/unit/<client>.test.ts` (DI fake or fetch monkey-patch) |
| New schema field | `tests/integration/schemas.test.ts` parses fresh captures |
| New CLI subcommand or wiring | `tests/integration/<cmd>.test.ts` patterned after `cli-failure.test.ts` |

## Notable invariants the tests pin down

- **`replacePiece` input shape** — `forkable.test.ts` asserts the exact captured-variables structure. If anyone ever "improves" `swapMeal` to send `{ groupId: [-1] }` for `selectionsHash` (the SPA's pattern, but locked v1 sends `{}`), the test fails immediately. See locked v1 design decisions.
- **Idempotency** — `picker.test.ts > a second run on the post-swap state issues no swaps`. Means a bot that crashes mid-Friday and gets re-triggered won't double-swap.
- **Per-day failure isolation** — `picker.test.ts > one day failing does not block other days`. One bad alternative-fetch can't poison the rest of the week.
- **Failure-email actually fires** — `cli-failure.test.ts` verifies both pick + dry-run failure paths POST to Resend. PRD §13 calls out failure email as a hard requirement.
- **Schema drift surfaces fast** — `schemas.test.ts` parses the captured JSON. If Forkable changes `myDeliveries[0].state` to `myDeliveries[0].status`, this test breaks before the bot crashes in production.

## See also

- `src/` — the code these tests cover
- `scripts/captures/` — real Forkable responses used by integration tests
- `../README.md` — top-level README (project setup, deployment)
