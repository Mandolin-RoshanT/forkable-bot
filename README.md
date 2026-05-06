# forkable-helper

Weekly meal auto-picker for [forkable.com](https://forkable.com/mc/). Scores each day's alternatives against a fat-loss rubric using `gpt-4o-mini` and swaps in the highest-scoring meal. Runs on GitHub Actions cron every Friday afternoon. Failure-only email notifications via Resend.


## Status

**Milestone 1 — Spike** (current). Capturing GraphQL operations from the Forkable SPA so subsequent milestones can replay them.

## Setup (local)

Requires [Bun](https://bun.sh) 1.2+.

```sh
cp .env.example .env
# fill in FORKABLE_EMAIL + FORKABLE_PASSWORD at minimum

bun install
```

