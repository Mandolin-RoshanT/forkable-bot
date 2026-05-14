# forkable-helper

Weekly meal auto-picker for [forkable.com](https://forkable.com/mc/). Logs in, scores each editable day's alternatives against a fat-loss rubric using `gpt-4o-mini`, and swaps to the highest-scoring meal. Runs on a Friday GitHub Actions cron. Failure-only emails via Resend.

## Run this for your own Forkable account

Fork the repo — each user runs their own copy with their own credentials and scoring history.

### 1. Fork the repo

Click **Fork** → "Create fork" into your own GitHub account.

### 2. Enable Actions in your fork

Forks have Actions disabled by default:

- **Settings → Actions → General → Allow all actions and reusable workflows**
- **Workflow permissions → Read and write permissions** — needed so the workflow can commit the per-week CSV back to your fork

### 3. Set the required secrets

**Settings → Secrets and variables → Actions → New repository secret**.

| Required | Name | Value |
|---|---|---|
| yes | `FORKABLE_EMAIL` | Your forkable.com login email |
| yes | `FORKABLE_PASSWORD` | Your forkable.com password (MFA must be off) |
| yes | `OPENAI_API_KEY` | OpenAI key from [platform.openai.com](https://platform.openai.com/api-keys). ~$0.001 per run. |
| yes | `RESEND_API_KEY` | Resend key from [resend.com](https://resend.com). Free tier (100/month) covers it. |
| yes | `NOTIFY_TO_EMAIL` | Where failure emails land |
| optional | `NOTIFY_FROM_EMAIL` | Defaults to `onboarding@resend.dev`. Override only if you've verified a custom domain in Resend. |

### 4. Verify with a manual dispatch

```sh
gh workflow run weekly-pick.yml -f mode=dry-run --repo YOUR_USERNAME/YOUR_FORK
gh run watch --repo YOUR_USERNAME/YOUR_FORK
```

Or in the UI: **Actions → Weekly meal picker → Run workflow → mode: dry-run**.

A successful run takes ~15s, prints decisions to the log, uploads `runs/<from>.csv` as a 90-day artifact, and commits the same file back to your fork.

### 5. Watch the Friday cron

The cron fires every Friday at 23:00 UTC (4pm PDT / 3pm PST). Compare the bot's picks (`runs/<from>.csv`, or the failure email if it broke) against the picks you'd have made manually.

### 6. Cutover from dry-run to live

Once the bot's picks match your taste, flip the cron default in `.github/workflows/weekly-pick.yml`:

```diff
-      - run: bun src/index.ts ${{ inputs.mode || 'dry-run' }}
+      - run: bun src/index.ts ${{ inputs.mode || 'pick' }}
```

### Heads-up before you fork

- **MFA must be off.** The bot fails fast with a clear error; it does not handle TOTP.
- **Rubric is fat-loss focused.** Edit `src/rubric.md` to fit your goals — it's plain Markdown loaded at runtime.
- **Schema drift.** If Forkable changes a field, the next run fails with a `ZodError`. See the recovery flow below.
- **Cost.** ~$0.001 per run for OpenAI; Resend free tier covers failure emails.

## Local development

Bun 1.2+:

```sh
cp .env.example .env
# FORKABLE_EMAIL + FORKABLE_PASSWORD needed for verify/spike/dry-run/pick
# OPENAI_API_KEY needed for show-week / dry-run / pick (unless --no-score)
# RESEND_API_KEY only for testing the failure-email path locally

bun install
bun run check          # typecheck + lint + tests (90 tests)
```

### Commands

```sh
bun run show-week              # print this week's days + scored alternatives
bun run show-week --no-score   # same, without OpenAI calls
bun run show-week 2026-05-04   # specific Monday
bun run dry-run                # what the picker would do — no writes
bun run dry-run 2026-05-04     # dry-run against a specific Monday
bun run dry-run --no-log       # …and don't write runs/<from>.csv
bun run pick                   # live: scores, swaps, posts
bun run pick 2026-05-04        # live against a specific Monday
bun run verify                 # ForkableClient + schemas against live API
bun run spike                  # log in + replay scripts/captures/raw/*.json
```

`show-week`, `dry-run`, and `pick` take an optional `YYYY-MM-DD` Monday; default is the current week.

Each `dry-run`/`pick` writes `runs/<from>.csv` (one file per delivery week). Columns: `runAt, mode, date, kind, fromVenue, fromMeal, toVenue, toMeal, bucket, summary`. Re-running the same week overwrites that week's file; past weeks stay. The cron commits the latest file and uploads it as a 90-day artifact. `--no-log` skips writing.

## Architecture

Three layers with a one-way dependency rule (Biome enforces it):

```
src/
├── clients/                   boundaries — talk to the outside world
│   ├── forkable.ts            login, getWeek, getAlternatives, swapMeal
│   ├── forkable-errors.ts     typed errors
│   ├── openai-scorer.ts       LLM scoring (falls back to red on parse failure)
│   ├── resend-mailer.ts       sendFailure
│   └── run-log-writer.ts      per-week CSV writer
├── core/                      pure logic, no I/O
│   ├── picker.ts              pickWeek — skip ORDERED, skip if default wins, all-red keeps default
│   ├── tiebreak.ts            price → venue variety → input order
│   └── run-log.ts             buildRows + toCsv (RFC-4180 escaping)
├── commands/                  one file per CLI subcommand
│   ├── show-week.ts           read-only week dump
│   └── run-picker.ts          pick / dry-run pipeline
├── lib/                       cli-format, cookie-jar, dates, error-message, exhaustive, fetch, forkable-shape, log-events, redact
├── queries/forkable.ts        GraphQL operation strings + variable types
├── schemas/forkable.ts        zod schemas — runtime validation + inferred types
├── config.ts                  loadSettings(env) — zod-validated env
├── logger.ts                  createLogger(settings) — scrubs secrets
├── models.ts                  domain types
├── rubric.md                  fat-loss prompt loaded at runtime
├── cli.ts                     subcommand dispatch
└── index.ts                   thin entry point with top-level catch
```

Tests live in `tests/{unit,integration,fixtures}/`. See [`tests/README.md`](tests/README.md) for what's covered.

## Schema-drift recovery

If Forkable changes a field, the next run fails with a `ZodError` naming the path (e.g. `myDeliveries.0.foo: Required`):

1. `bun run verify` — reproduce the parse failure locally
2. Re-capture from DevTools per [`scripts/CAPTURE.md`](scripts/CAPTURE.md), drop into `scripts/captures/raw/`
3. `bun run spike` — dump the new response
4. Update `src/queries/forkable.ts` / `src/schemas/forkable.ts` to match
5. `bun run check` — `tests/integration/schemas.test.ts` parses the new captures

## Troubleshooting

| Error | Likely cause | Fix |
|---|---|---|
| `createSession returned no user` | Password rotated or wrong | Update `FORKABLE_PASSWORD` |
| `MFA is enabled — bot cannot proceed` | MFA on Forkable account | Disable MFA (TOTP unsupported) |
| `createSession set no new cookies` | Auth path changed at the edge | Re-capture per `scripts/CAPTURE.md` |
| `HTTP 401 Unauthorized` | AWS ALB sticky-cookie warmup broke | Forkable LB change; usually transient |
| `Invalid configuration: …` | Required env var missing | Error names the field; check your secrets |

## See also

- [`TODO.md`](TODO.md) — deferred cleanups & improvements
- [`scripts/CAPTURE.md`](scripts/CAPTURE.md) — DevTools capture protocol
- [`tests/README.md`](tests/README.md) — test layout & invariants
