# Spike findings (M1)

> Status: **complete.** All three operations captured live from forkable.com/mc on 2026-05-05.
> Files: `scripts/captures/raw/{get-week,get-alternatives,swap-meal}.json`.
> Earlier blind-probing notes preserved at the bottom of this file for reference.

---

## Auth — confirmed working

- ✅ `createSession` mutation succeeds with `.env` credentials.
- ✅ `me` query returns user 305827, `mfaEnabled: false`.
- ✅ Session cookie name observed: **`_easyorder_session`** (Devise / Rails).
- ✅ ALB sticky cookies needed: **`AWSALBTG`** + **`AWSALBTGCORS`** (acquired via 401 warmup).

## Required headers beyond `Content-Type`

| Header | Required? | Notes |
|---|---|---|
| `Content-Type: application/json` | ✅ yes | Standard |
| `Accept: application/json` | ✅ yes | Captured on every SPA request |
| `Forkable-Referrer: mc` | ✅ yes | **Custom header.** Captured on every authenticated request. Mirror exactly. |
| `Origin: https://forkable.com` | ✅ yes | CSRF-style check (always present on browser requests) |
| `Referer: https://forkable.com/mc/` | ✅ yes | Same |
| `User-Agent` (browser-shaped) | ✅ yes | Edge filtering rejects curl-style UAs |
| `X-CSRF-Token` | ❌ no | Not used |
| `X-Apollo-Operation-*` | ❌ no | Not Apollo-based |

## SPA architecture (from bundle inspection)

- **Not Apollo / not graphql-tag.** Custom query builder (`select(...).includes({...})`) assembles operations at runtime — that's why a DevTools capture is the only way to get the exact wire format the SPA sends.
- Bundle root: `forkable.com/mc/js/app.<hash>.js` + 114 webpack chunks under `/mc/js/<id>.<hash>.js`.

## GraphQL operations — captured

### Queries / mutations the bot needs

| Purpose | Query/mutation | Capture file | Variables shape |
|---|---|---|---|
| Get the week's days + default meals | **`myDeliveries(from: "YYYY-MM-DD")`** (anonymous query, args inlined into query string, `variables: {}`) | `get-week.json` | `{}` — `from` is templated into the query string before sending |
| Get alternatives for a day | **`menus(ids: [...], clubId: N)`** (anonymous query, args inlined, `variables: {}`) | `get-alternatives.json` | `{}` — bot fills `ids` from the day's `availableMenuIds` and `clubId` from `day.club.id` |
| Swap a meal | **`mutation { replacePiece(input: ReplacePieceInput!) }`** | `swap-meal.json` | `{ input: { deliveryId, itemId, menuId, instructions, selectionsHash, fromTopRated, topRatedType, oldPieceId, myMeals } }` |

> **Resolution of an earlier open question:** the top-level weekly query is `myDeliveries(from:)`, **not** `orders(weekOf:)` and **not** `deliveries(from:)`. `myDeliveries` returns the right `Delivery` shape with full `orders[].pieces[]` nested. The `orders(weekOf:)` lookups in the earlier probing returned empty because they're a different field on the schema.

> **Note on swap-meal.json:** captured payload swaps Wednesday's Chicken and Broccoli Bowl → Beef Stew, then a follow-up swap-back to restore state. The shape is what matters; the bot fills in real `deliveryId`/`itemId`/`menuId`/`oldPieceId` per pick. The user's actual meal selection was preserved at the end of the spike.

### Login flow (captured separately during PRD scoping)

```graphql
# Step 1 (anonymous, optional):
POST /api/v2/public/graphql
query { identities(email: "USER") { integration { type provider loginUrl allowSsoPasswordLogin } } }

# Step 2 (the actual login — sets session cookie via Set-Cookie):
POST /api/v2/graphql
mutation ($input: CreateSessionInput!) {
  createSession(input: $input) { user { id email mfaEnabled } errorAttributes errorDetails }
}
# variables: { input: { email, password } }

# Step 3 (auth check):
POST /api/v2/graphql
{ query: "{ me { id email mfaEnabled } }" }
```

## `Delivery` shape (our "Day" model — from `myDeliveries` response)

```
id state                       ← STATUS string ("initial" | "grace_period" | "receipt_sent" | ...)
simpleState                    ← simpler bucket ("delivered" | "ordered" | null)
forDeliveryAt                  ← ISO 8601 timestamp
deliveryWindow                 ← ["12:00", "12:30"]
isReadOnly                     ← BOOLEAN — source of truth for "can the bot swap this day?"
userConfirmed                  ← bool
mealClubId copayAmount isPreferred afternoon
serviceWindow { baseTime name }
allowanceType weeklyAllowance weeklyAllowanceAvailable
estimatedArrivalAt
availableMenuIds               ← Int[] — feeds the menus(ids:) alternatives query
pastLateOrderDeadline          ← bool
canRequestChanges              ← bool
reportMissingItemCutoff        ← ISO 8601 timestamp
address { street city formatted }
orders { id state ... pieces { id itemId menuId name selections ... } replacementCutoffTs ... }
club { id name ... }           ← feeds the menus(clubId:) alternatives query
userReceipt { ... }
```

### Editable-day predicate

**`day.isReadOnly === false`** is the source of truth. Both `state: grace_period` and `state: receipt_sent` come back with `isReadOnly: true`; only `state: initial` is `isReadOnly: false`.

### Sample (week of May 4, 2026, captured live)

```json
[
  { "date": "2026-05-04", "state": "receipt_sent", "simpleState": "delivered", "isReadOnly": true },
  { "date": "2026-05-05", "state": "grace_period", "simpleState": "ordered",   "isReadOnly": true  },
  { "date": "2026-05-06", "state": "initial",      "simpleState": null,         "isReadOnly": false },
  { "date": "2026-05-07", "state": "initial",      "simpleState": null,         "isReadOnly": false },
  { "date": "2026-05-08", "state": "initial",      "simpleState": null,         "isReadOnly": false }
]
```

### Cutoff fields

- **`reportMissingItemCutoff`** is on every day (ISO 8601 timestamp).
- **`replacementCutoffTs`** is on `orders[0]` (null on editable days; populated when locked).
- For the bot, neither is strictly needed — `isReadOnly` already gates correctness — but `reportMissingItemCutoff` is useful for a "this is the deadline we're racing" log line.

## Meal-swap workflow

`replacePiece(input: { ... })` fires on the SPA's "Add for $X" button click. Captured input:

```json
{
  "input": {
    "deliveryId": 1175988,
    "itemId": 33,
    "menuId": 17826,
    "instructions": "",
    "selectionsHash": { "32": [-1], "99": [96] },
    "fromTopRated": true,
    "topRatedType": "venue_rating",
    "oldPieceId": "90e67341-4f2f-423c-89bd-78173137d364",
    "myMeals": true
  }
}
```

- `deliveryId`: from `day.id`.
- `itemId` / `menuId`: from the chosen alternative (`menus[].sections[].items[]`).
- `selectionsHash`: keys are modifier-group ids, values are option ids; `-1` means "default option for this group". For v1, the bot reads the current piece's `selections` field and passes it through unchanged so customizations don't change.
- `fromTopRated` / `topRatedType`: analytics fields. Setting them to false / null also worked in informal testing — likely safe to omit, but the bot mirrors the SPA values to look identical.
- `oldPieceId`: UUID of the piece being replaced. Bot reads from `myDeliveries[].orders[0].pieces[].id` for that day.
- `myMeals`: true.

The mutation auto-confirms (no `changeRequest` review step in the user's case). Verify by re-querying `myDeliveries` after the swap.

## Useful side-discoveries

- **Forkable already has its own `mealGenerationScores` query**: `query { mealGenerationScores(deliveryId, menuIds, userId) { menuId itemId score } }`. Worth experimenting with as an LLM input or fallback. Out of scope for v1.
- **Anonymous-query convention**: most read queries are sent anonymous (`query { ... }`) with args inlined into the query string and `variables: {}`. Mutations DO use the variables map. Bot mirrors this exactly.

## Decisions for M2

- ✅ **Cookie jar**: hand-rolled (~15 LOC). `_easyorder_session` + the two AWSALBTG cookies. Skip `tough-cookie`.
- ✅ **`operationName` field**: omit. Mirror the SPA — empty/absent. Send `{ query, variables }`.
- ✅ **`Forkable-Referrer: mc`**: yes, on every request.
- ✅ **Editable-day predicate**: `day.isReadOnly === false`. Don't try to derive from `state` directly.
- ✅ **Swap mutation fields**: send all observed fields including `fromTopRated` / `topRatedType` / `myMeals` to look identical to the SPA. Carry `selectionsHash` from the source piece (no modifier changes in v1).
- ✅ **Custom GraphQL builder is internal to the SPA**; we write our own `.graphql` files matching the captured wire format.
- ✅ **First mutation to wire up**: `replacePiece` (input shape verified end-to-end).
- ✅ Probe scripts (`scripts/introspect.ts`, `scripts/probe.ts`) kept as references for future schema-debugging sessions.

---

## Earlier blind-probing notes (kept for reference)

Before the live DevTools capture, a `bun run probe` session enumerated parts of the schema by reading server error messages. That work confirmed `replacePiece` and the `Order` field shape. The capture confirmed `myDeliveries` (not `orders(weekOf:)`) is the correct entry point for the dashboard view, and resolved the alternatives query as `menus(ids:, clubId:)`.
