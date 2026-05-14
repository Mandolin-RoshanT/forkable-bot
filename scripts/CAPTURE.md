# DevTools capture protocol

The `bun run spike` script (`scripts/capture-ops.ts`) verifies our `createSession` login works end-to-end, then **replays** any GraphQL operations it finds in `scripts/captures/raw/*.json`, dumping each response to `scripts/captures/<op_name>.json`.

Use this whenever Forkable changes a GraphQL response shape and the bot's Zod schemas start failing — re-capture, re-run the spike, then update `src/queries/` and `src/schemas/` until tests pass again.

This file documents how to grab those raw payloads from the live Forkable SPA.

---

## Prerequisites

- Logged into [forkable.com/mc](https://forkable.com/mc/) in Chrome/Firefox.
- DevTools open (`Cmd+Opt+I`).
- Network tab → filter set to `Fetch/XHR` → text filter `graphql`.

---

## Operations to capture

| # | Operation | Trigger in the UI |
|---|---|---|
| 1 | **`getWeek`** (or whatever the SPA calls it) | Reload the page, or navigate to a week with the date pickers. The first big query that fires is the dashboard week query. |
| 2 | **`getAlternatives`** | Click any editable day → click "Choose Another Meal". The modal fires this query for that day's alternatives. |
| 3 | **`swapMeal`** / **`selectMeal`** | Inside the alternatives modal, click "Select Meal" on any meal that's *the same as the current default* (so you don't actually change anything). Watch for the mutation that fires. |
| 4 | *(bonus)* `me` | Page load already fires this. Optional — confirms our auth flow returns the same shape. |

---

## How to extract a raw payload

For each operation:

1. In the Network tab, click the request.
2. Switch to the **Payload** sub-tab. You'll see something like:

   ```json
   {
     "operationName": "getWeek",
     "variables": { "startsAt": "2026-05-04" },
     "query": "query getWeek($startsAt: ISO8601Date!) { ... }"
   }
   ```

3. Right-click → **Copy** → **Copy value** (or click "view source" then copy).
4. Save to `scripts/captures/raw/<op-name>.json` using kebab-case filenames:

   ```
   scripts/captures/raw/get-week.json
   scripts/captures/raw/get-alternatives.json
   scripts/captures/raw/swap-meal.json
   ```

5. Also note:
   - Any non-standard request **headers** (CSRF, `X-Apollo-Operation-Id`, etc.). Switch to the **Headers** sub-tab → "Request Headers". Add to `BROWSER_HEADERS` at the top of `src/clients/forkable.ts` if needed.
   - The day object's **status** field name (`ORDERED` vs editable) and the **cutoff** field name. Update `src/schemas/forkable.ts` accordingly.

---

## Safety notes

- **Mutations are NOT replayed by default.** `capture-ops.ts` detects `mutation { ... }` queries and skips them unless you pass `--mutate`. This is to prevent the spike from accidentally swapping a real meal.
- **PII**: `scripts/captures/` is gitignored. Don't move files out of it without scrubbing meal IDs, internal user IDs, and cookie values.
- **Cookie**: never paste a `Cookie` header from DevTools into a captured payload file. The script generates its own auth via `createSession`.

---

## Run the spike

After dropping files into `scripts/captures/raw/`:

```sh
bun run spike
```

Expected output (minimal, with redacted secrets):

```
[capture-ops] loading credentials from .env
[capture-ops] identities lookup → password auth, mfa: false
[capture-ops] createSession → ok (user 12345, mfa: false)
[capture-ops] cookie attached: <19 chars, prefix: AbCd>
[capture-ops] me → ok (user 12345)
[capture-ops] login flow verified
[capture-ops] replaying 2 query operation(s) from scripts/captures/raw/
[capture-ops]   get-week → ok, 8.2KB → scripts/captures/get-week.json
[capture-ops]   get-alternatives → ok, 12.4KB → scripts/captures/get-alternatives.json
[capture-ops] skipped 1 mutation (use --mutate to replay): swap-meal
[capture-ops] done
```
