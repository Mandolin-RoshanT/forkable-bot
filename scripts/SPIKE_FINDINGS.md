# Spike findings (M1)

Fill this in as you complete the spike. These answers feed M2's `src/clients/forkable.ts` and `src/queries/*.graphql`.

---

## Auth — confirmed working?

- [ ] `createSession` mutation succeeds with `.env` credentials.
- [ ] `me` query returns expected user with `mfaEnabled: false`.
- [ ] Session cookie name observed: _____________________

## GraphQL operations captured

| Operation | Operation name | File in `scripts/captures/raw/` | Variables shape |
|---|---|---|---|
| Get week's days + default meals | _____ | `get-week.json` | `{ startsAt: "ISO8601Date" ... }` |
| Get alternatives for a day | _____ | `get-alternatives.json` | _____ |
| Swap / select a meal | _____ | `swap-meal.json` | _____ |

## Day object schema (from `getWeek` response)

- Status field name (e.g., `status`, `state`, `orderState`): _____________________
- Editable values: _____________________ (e.g., `EDITABLE`, `OPEN`)
- Locked value: _____________________ (e.g., `ORDERED`, `LOCKED`)
- Cutoff field name: _____________________
- Cutoff format: _____ (ISO timestamp / unix epoch / null when locked)

## Required headers beyond `Content-Type`

List anything DevTools shows in "Request Headers" that isn't standard:

- [ ] `X-CSRF-Token` — required? value source?
- [ ] `X-Apollo-Operation-Name` — required?
- [ ] `X-Apollo-Operation-Id` — required?
- [ ] User-Agent restrictions observed?
- [ ] Other: _____________________

## Open issues / surprises

- _____________________
- _____________________

## Decisions for M2

- [ ] Cookie jar approach: hand-rolled (~15 LOC) | `tough-cookie` if multi-cookie complexity surfaces
- [ ] Whether to send `operationName` field in request body (we'll mirror what the SPA does)
