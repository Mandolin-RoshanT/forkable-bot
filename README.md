# forkable-helper

Weekly meal auto-picker for [forkable.com](https://forkable.com/mc/). Logs in to your Forkable account, scores each editable day's alternatives against a fat-loss rubric using `gpt-4o-mini`, and swaps to the highest-scoring meal. Runs on a Friday GitHub Actions cron. Failure-only emails via Resend.

## Run this for your own Forkable account

The bot is designed to be **forked**: each user runs their own copy on their own GitHub Actions, with their own Forkable credentials, scoring history, and email destination. Nothing about the upstream repo needs to know you exist.

### 1. Fork the repo

Click **Fork** at the top of this page → "Create fork" into your own GitHub account.

### 2. Enable Actions in your fork

Forks have GitHub Actions disabled by default as a security measure. In your fork:

- **Settings → Actions → General → Allow all actions and reusable workflows**
- (And if you scroll down) **Workflow permissions → Read and write permissions** — needed because the workflow commits the per-week CSV back to your fork

### 3. Set the required secrets

In your fork: **Settings → Secrets and variables → Actions → New repository secret**.

| Required | Name | Value |
|---|---|---|
| ✅ | `FORKABLE_EMAIL` | Your forkable.com login email |
| ✅ | `FORKABLE_PASSWORD` | Your forkable.com password (MFA must be off; see below) |
| ✅ | `OPENAI_API_KEY` | An OpenAI API key — get one at [platform.openai.com](https://platform.openai.com/api-keys). Each run costs ~$0.001. |
| ✅ | `RESEND_API_KEY` | A Resend API key for failure emails — get one at [resend.com](https://resend.com). Free tier (100 emails/month) is plenty. |
| ✅ | `NOTIFY_TO_EMAIL` | Where failure emails should land — usually your inbox |
| optional | `NOTIFY_FROM_EMAIL` | The "From:" address. Defaults to `onboarding@resend.dev` (Resend's universally-verified sender). Only set this if you've verified a custom domain in Resend. |

### 4. Verify with a manual dispatch

```sh
gh workflow run weekly-pick.yml -f mode=dry-run --repo YOUR_USERNAME/forkable-bot
gh run watch --repo YOUR_USERNAME/forkable-bot
```

Or in the UI: **Actions → Weekly meal picker → Run workflow → mode: dry-run**.

A successful run takes ~15 seconds, prints the picker's decisions to the run log, uploads `runs/<from>.csv` as an artifact (90-day retention), and commits the same file back to your fork's `runs/` folder.

### 5. Watch the Friday cron

The cron fires automatically every Friday at 23:00 UTC (4pm PDT, 3pm PST) on whatever your fork's default branch is. Compare the bot's picks (in `runs/<from>.csv` or in the failure email if it broke) against the picks you'd have made manually.

### 6. Cutover from dry-run to live (M4)

Once you're satisfied that the bot's picks match your taste — usually after one full week of dry-run runs — flip the cron's default in `.github/workflows/weekly-pick.yml`:

```diff
-      - run: bun src/index.ts ${{ inputs.mode || 'dry-run' }}
+      - run: bun src/index.ts ${{ inputs.mode || 'pick' }}
```

That one-line change is the only difference between "tells me what it would do" and "actually does it."

### Heads-up before you fork

- **MFA must be off** on your Forkable account. The bot fails fast with a clear error otherwise; it does not handle TOTP. (See [Issue #3](https://github.com/Mandolin-RoshanT/forkable-bot/issues/3) for tracking.)
- **The rubric is fat-loss focused.** It's at `src/rubric.md` — a plain Markdown file that gets loaded at runtime. Fork-specific edits won't conflict with upstream as long as you don't rebase that file.
- **Schema drift.** If Forkable changes a field, the next run fails fast with a `ZodError`. The recovery flow is documented below — and your fork's `runs/` history makes it easy to spot when the failure started.
- **Cost.** ~$0.001 per run for OpenAI; Resend free tier covers failure emails. No shared infra costs.

## Local development

If you're hacking on the bot itself (vs running it on your account), Bun 1.3+:

```sh
cp .env.example .env
# fill in FORKABLE_EMAIL + FORKABLE_PASSWORD (required for verify/spike/dry-run/pick)
# OPENAI_API_KEY also required for show-week / dry-run / pick (without --no-score)
# RESEND_API_KEY only needed if you want to test the failure-email path locally

bun install
bun run check          # typecheck + lint + tests (90 tests)
```

### Commands

```sh
bun run show-week              # print this week's days + scored alternatives
bun run show-week --no-score   # same, without OpenAI calls
bun run show-week 2026-05-04   # specific Monday
bun run dry-run                # what the picker would do — no writes
bun run dry-run --no-log       # …and don't write runs/<from>.csv
bun run pick                   # live: scores, swaps, posts
bun run verify                 # ForkableClient + schemas against live API
bun run spike                  # spike: log in + replay scripts/captures/raw/*.json
```

Each `dry-run` and `pick` invocation writes a fresh `runs/<from>.csv` (one file per delivery week, where `<from>` is the Monday of the target week). Columns: `runAt, mode, date, kind, fromVenue, fromMeal, toVenue, toMeal, bucket, summary`. Re-running the same week (e.g. dry-run earlier in the week, then the cron) overwrites that week's file; previous weeks' files are left alone as standalone snapshots. The cron commits the latest file back to the repo, and each run also uploads its CSV as a 90-day artifact. Pass `--no-log` locally if you don't want test runs to dirty git.

## Architecture

Three layers with a one-way dependency rule (Biome enforces it):

```
src/
├── clients/                  boundaries — talk to the outside world
│   ├── forkable.ts           ForkableClient (login, getWeek, getAlternatives, swapMeal)
│   ├── openai-scorer.ts      OpenAIScorer (LLM scoring, falls back to red on parse failure)
│   ├── resend-mailer.ts      ResendMailer.fromEnv() (sendFailure, sendSummary)
│   └── run-log-writer.ts     CsvRunLogWriter — per-week CSV
├── core/                     pure logic, no I/O
│   ├── picker.ts             pickWeek(args) — locked decisions (skip ORDERED, skip if default wins, all-red keeps default)
│   ├── tiebreak.ts           breakTie(candidates, picksThisWeek) — price → venue variety → input order
│   └── run-log.ts            buildRows + toCsv (RFC-4180 escaping)
├── lib/                      small utilities (constants, cookie-jar, dates, exhaustive)
├── queries/forkable.ts       GraphQL operation strings + variable types
├── schemas/forkable.ts       zod schemas — runtime validation + inferred types
├── config.ts                 loadSettings(env) — zod-validated env
├── logger.ts                 createLogger(settings) — scrubs secrets
├── models.ts                 domain types (Bucket, Score, MealCandidate, DayResult, WeekResult)
├── rubric.md                 fat-loss prompt loaded at runtime
├── cli.ts                    show-week / dry-run / pick subcommand dispatch
└── index.ts                  thin entry point with top-level catch
```

Tests live in `tests/{unit,integration,fixtures}/` (90 tests; `bun test`).

## Schema-drift recovery

If Forkable changes a field, the next run fails fast with a `ZodError` naming the path (e.g. `myDeliveries.0.foo: Required`). Recovery:

1. Reproduce locally: `bun run verify` shows where the parse failed
2. Re-capture from DevTools per [`scripts/CAPTURE.md`](scripts/CAPTURE.md), drop into `scripts/captures/raw/`
3. `bun run spike` to dump the new response
4. Update `src/queries/forkable.ts` and/or `src/schemas/forkable.ts` to match
5. `bun run check` — `tests/integration/schemas.test.ts` parses the new captures

The spike scripts (`scripts/{capture-ops,probe,introspect,verify-queries}.ts`) are kept as ongoing debug tooling, not throwaway code.

## Troubleshooting

| Error | Likely cause | Fix |
|---|---|---|
| `createSession returned no user` | Password is wrong or was rotated | Update the `FORKABLE_PASSWORD` secret |
| `MFA is enabled — bot cannot proceed` | MFA was enabled on the Forkable account | Disable MFA, or wait for the bot to support TOTP |
| `createSession set no new cookies — auth flow broken` | The auth path changed at the edge | Re-capture the `createSession` mutation per `scripts/CAPTURE.md` |
| `HTTP 401 Unauthorized` | AWS ALB sticky-cookie warmup broke | Forkable changed their LB config; usually transient |
| `Invalid configuration: …` | A required env var is missing | The error names the field; check the secrets in your fork |

## Living docs

- `TODO.md` — known cleanups + improvements deferred for after M4
- `scripts/CAPTURE.md` — DevTools capture protocol
- [Issue #3](https://github.com/Mandolin-RoshanT/forkable-bot/issues/3) — multi-user / hosted-service direction
