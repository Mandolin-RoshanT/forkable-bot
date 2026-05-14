# Test suite

90 tests across 15 files (`bun test`). Three layers, three mocking strategies — each chosen to test the unit at the right level without leaking the layer below it.

## Unit (`tests/unit/`)

Pure logic with dependency-injected fakes.

| File | Module | Tests | Mocks |
|---|---|---|---|
| `config.test.ts` | `src/config.ts` | env validation, required-field errors, `NOTIFY_FROM_EMAIL` default + empty-string fallback | synthetic `env` |
| `cookie-jar.test.ts` | `src/lib/cookie-jar.ts` | parses `Set-Cookie`, snapshot/diff detects new cookies, `serialize()` undefined on empty jar | real `Headers` |
| `dates.test.ts` | `src/lib/dates.ts` | `thisWeekMonday(now)` for Monday/Friday/Sunday inputs | injected `Date` |
| `logger.test.ts` | `src/logger.ts` | secret scrubbing across `info`/`error`/`debug`, `debug` gating, `error` → stderr | captured `console.log`/`console.error` |
| `openai-scorer.test.ts` | `src/clients/openai-scorer.ts` | green/red parsing, four parse-failure paths, only relevant fields go to the LLM | injected `ChatCompleter` |
| `picker.test.ts` | `src/core/picker.ts` | locked-day skip, kept-default, swap, dry-run noop, idempotency, all-red keeps default, per-day failure isolation, no-default branch | synthetic `Delivery`/`Menu` factories |
| `redact.test.ts` | `src/lib/redact.ts` | `redactEmail` masks local part; `redactCookie` keeps length + 4-char prefix | none |
| `resend-mailer.test.ts` | `src/clients/resend-mailer.ts` | bearer-auth header, JSON body shape, throw on non-2xx | monkey-patched `globalThis.fetch` |
| `run-log.test.ts` | `src/core/run-log.ts` | every `DayResult.kind` → row shape, RFC-4180 escaping, header always emitted, `mode` column | synthetic `WeekResult` |
| `run-log-writer.test.ts` | `src/clients/run-log-writer.ts` | overwrite-on-write, parent-dir creation, no-op on empty rows | tempdir-isolated FS (`mkdtemp` per test) |
| `tiebreak.test.ts` | `src/core/tiebreak.ts` | empty-input throw, price → venue variety → input order, null-price fallback | synthetic candidates |

## Integration (`tests/integration/`)

Multiple modules wired together.

| File | Layers | Tests | Mocks |
|---|---|---|---|
| `forkable.test.ts` | `ForkableClient` end-to-end | happy paths, auth/transport/schema errors, **`replacePiece` locked input shape** (`selectionsHash: {}`), `requireLogin` guard | MSW + `graphqlHandler` (warmup-401 baked in) |
| `schemas.test.ts` | Zod schemas vs real captured JSON | schema-drift tripwire — every response shape we depend on parses the captured payloads | real captures in `scripts/captures/` |
| `e2e.test.ts` | picker + ForkableClient + schemas + swap | locked days skipped, editable day swaps to green, dry-run never invokes swap | MSW + stub `ChatCompleter` |
| `cli-failure.test.ts` | `cli.run` + `runPicker` → `ResendMailer` | unknown subcommand exits 1; failure-email path actually POSTs to Resend with the right subject/body | MSW for forkable.com + api.resend.com |

## Fixtures (`tests/fixtures/msw.ts`)

`createTestServer({ onUnhandledRequest? })` (registers lifecycle hooks), `graphqlHandler({ ...routes })` (dispatches by `operationName`, warmup-401 baked in), `silentLogger`, `VALID_USER`, `SESSION_COOKIE_HEADERS`, response builders `createSessionOk()` / `meOk()`.

## Running

```sh
bun test                       # all 90 tests
bun test tests/unit/           # unit only
bun test tests/integration/    # integration only
bun test tests/unit/picker     # one file
bun run check                  # typecheck + lint + tests (the gate before commit)
```

Tests run sequentially per file; Bun handles file isolation. No flakiness expected — every test mocks its dependencies.

## Where new tests go

| Adding | Goes in |
|---|---|
| New pure function in `src/core/` | `tests/unit/<module>.test.ts` with synthetic data |
| New `ForkableClient` method | `tests/integration/forkable.test.ts` with an MSW route |
| New `clients/*` boundary | `tests/unit/<client>.test.ts` (DI fake or fetch monkey-patch) |
| New schema field | `tests/integration/schemas.test.ts` parses fresh captures |
| New CLI subcommand | `tests/integration/<cmd>.test.ts` patterned after `cli-failure.test.ts` |

## Invariants pinned by the suite

- **`replacePiece` input shape** — `forkable.test.ts` asserts `selectionsHash: {}` (locked v1). If anyone sends `{ groupId: [-1] }` instead (the SPA pattern), the test fails immediately.
- **Idempotency** — `picker.test.ts` proves a second run on the post-swap state issues no swaps. A bot that crashes mid-Friday won't double-swap on re-trigger.
- **Per-day failure isolation** — one bad alternative-fetch can't poison the rest of the week.
- **Failure-email fires** — `cli-failure.test.ts` verifies both pick and dry-run failure paths POST to Resend.
- **Schema drift surfaces fast** — captured JSON breaks `schemas.test.ts` before it breaks production.

## See also

- `src/` — the code these tests cover
- `scripts/captures/` — real Forkable responses used by integration tests
- `../README.md` — top-level README (project setup, deployment)
