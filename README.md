# forkable-helper

Weekly meal auto-picker for [forkable.com](https://forkable.com/mc/). Scores each day's alternatives against a fat-loss rubric using `gpt-4o-mini` and swaps in the highest-scoring meal. Runs on GitHub Actions cron every Friday afternoon. Failure-only email notifications via Resend.

See [`/Users/howardweingram/.claude/plans/heres-what-i-want-refactored-hollerith.md`](../../.claude/plans/heres-what-i-want-refactored-hollerith.md) for the full plan.

## Status

**Milestone 1 — Spike** (current). Capturing GraphQL operations from the Forkable SPA so subsequent milestones can replay them.

## Setup (local)

Requires [Bun](https://bun.sh) 1.2+.

```sh
cp .env.example .env
# fill in FORKABLE_EMAIL + FORKABLE_PASSWORD at minimum

bun install
```

## Spike (M1)

```sh
bun run spike    # logs in, runs `me`, replays anything in scripts/captures/raw/
```

See [`scripts/CAPTURE.md`](scripts/CAPTURE.md) for the DevTools capture protocol.

## Once M2 lands

```sh
bun run show-week    # prints next week's state with scored alternatives
bun run dry-run      # what the bot would pick (no writes)
bun run pick         # live: scores + swaps
bun run check        # typecheck + lint + tests
```
