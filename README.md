# forkable-helper

Weekly meal auto-picker for [forkable.com](https://forkable.com/mc/). Logs in, scores each editable day's alternatives against a fat-loss rubric using `gpt-4o-mini`, and swaps to the highest-scoring meal. Runs on a Friday GitHub Actions cron. Failure-only emails via Resend.

## Status

M1 (spike) + M2 (read-only scoring) + M3 (writes + scheduling) are complete. The bot is in the **dry-run validation phase**: the GitHub Actions workflow runs in `dry-run` mode by default until manual picks have been compared to bot picks for one full week. M4 cutover is a one-line YAML change to flip the workflow's default `mode` to `pick`.

## Local setup

Requires [Bun](https://bun.sh) 1.3+.

```sh
cp .env.example .env
# fill in FORKABLE_EMAIL + FORKABLE_PASSWORD (required)
# OPENAI_API_KEY is required for show-week / dry-run / pick
# RESEND_API_KEY only needed if you want failure emails locally

bun install
bun run check          # typecheck + lint + tests
```

## Commands

```sh
bun run show-week              # print next week's days + scored alternatives
bun run show-week --no-score   # same, without OpenAI calls
bun run show-week 2026-05-04   # specific Monday
bun run dry-run                # what the picker would do — no writes
bun run pick                   # live: scores, swaps, posts
bun run verify                 # ForkableClient + schemas against live API
bun run spike                  # spike: log in + replay scripts/captures/raw/*.json
```

## Architecture

Three layers with a one-way dependency rule (Biome enforces it):

```
src/
├── clients/                  boundaries — talk to the outside world
│   ├── forkable.ts           ForkableClient (login, getWeek, getAlternatives, swapMeal)
│   ├── openai-scorer.ts      OpenAIScorer (LLM scoring, falls back to red on parse failure)
│   └── resend-mailer.ts      ResendMailer.fromEnv() (sendFailure, sendSummary)
├── core/                     pure logic, no I/O
│   ├── picker.ts             pickWeek(args) — locked decisions (skip ORDERED, skip if default wins, all-red keeps default)
│   └── tiebreak.ts           breakTie(candidates, picksThisWeek) — price → venue variety → input order
├── lib/                      small utilities
│   ├── constants.ts          FORKABLE_GRAPHQL, BROWSER_HEADERS (one source of truth)
│   ├── cookie-jar.ts         hand-rolled jar with snapshot/diff
│   ├── dates.ts              thisWeekMonday()
│   └── exhaustive.ts         assertNever()
├── queries/forkable.ts       GraphQL operation strings + variable types
├── schemas/forkable.ts       zod schemas — runtime validation + inferred types
├── config.ts                 loadSettings(env) — zod-validated env
├── logger.ts                 createLogger(settings) — scrubs secrets
├── models.ts                 domain types (Bucket, Score, MealCandidate, DayResult, WeekResult)
├── rubric.md                 fat-loss prompt loaded at runtime
├── cli.ts                    show-week / dry-run / pick subcommand dispatch
└── index.ts                  thin entry point with top-level catch
```

Tests live in `tests/{unit,integration,fixtures}/` (~60 tests; see `bun test`).

## Deployment

**Repository secrets** (Settings → Secrets and variables → Actions):

| Name | Notes |
|---|---|
| `FORKABLE_EMAIL` | Account that has weekly delivery orders |
| `FORKABLE_PASSWORD` | MFA must be off — bot fails fast otherwise |
| `OPENAI_API_KEY` | Used for `gpt-4o-mini` scoring |
| `RESEND_API_KEY` | Failure email sender |
| `NOTIFY_TO_EMAIL` | Where failure emails go |
| `NOTIFY_FROM_EMAIL` | A verified Resend sender, e.g. `onboarding@resend.dev` |

**Workflow** lives at `.github/workflows/weekly-pick.yml`:

- Cron: Friday 23:00 UTC (4pm PDT, 3pm PST)
- `workflow_dispatch` with a `mode` choice input (`dry-run` | `pick`)
- Default mode for cron is `dry-run`. Flip to `pick` after validation.

Manual trigger:

```sh
gh workflow run weekly-pick.yml -f mode=dry-run
```

## Schema-drift recovery

If Forkable changes a field, the next run fails fast with a `ZodError` naming the path (`forkable schema parse failed: myDeliveries.0.foo: Required`). Recovery:

1. Reproduce locally: `bun run verify` shows where the parse failed
2. Re-capture from DevTools per `scripts/CAPTURE.md`, drop into `scripts/captures/raw/`
3. `bun run spike` to dump the new response
4. Update `src/queries/forkable.ts` and/or `src/schemas/forkable.ts` to match
5. `bun run check` — `tests/integration/schemas.test.ts` parses the new captures

The spike scripts (`scripts/{capture-ops,probe,introspect,verify-queries}.ts`) are kept as ongoing debug tooling, not throwaway code.

## Troubleshooting

- **`createSession returned no user`** → password is wrong or rotated. Update the `FORKABLE_PASSWORD` secret.
- **`MFA is enabled — bot cannot proceed`** → MFA was turned on. Disable it on the Forkable account or extend the bot to handle TOTP.
- **`createSession set no new cookies — auth flow broken`** → the auth path changed at the edge. Re-capture the createSession mutation per `scripts/CAPTURE.md`.
- **`HTTP 401 Unauthorized`** → likely the AWS ALB sticky-cookie warmup broke. The client already does the `__typename` warmup, but if Forkable changes their LB config we'll see this.
- **`introspection BLOCKED`** → expected — Forkable disables introspection in production. The bot doesn't need it.

## Living docs

- `TODO.md` — known cleanups + improvements deferred for after M4
- `scripts/SPIKE_FINDINGS.md` — historical record of M1 schema discovery
- `scripts/CAPTURE.md` — DevTools capture protocol
