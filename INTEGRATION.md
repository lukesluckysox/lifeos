# Shared View — integration guide

This folder mirrors `lifeos`'s real paths. Drop each file into your clone at
the matching path and overwrite. Two files below are **full replacements**
you already have originals of; the rest are **new files** with no existing
counterpart, plus three small manual edits to files I didn't have complete
copies of (so I didn't touch them blind).

## Files to drop in (same relative paths as the repo)

Full replacements (safe — built from your actual current file contents):
- `server/storage.ts` — adds `households`, `household_members`,
  `household_invites`, `account_visibility` tables + CRUD methods.
- `client/src/App.tsx` — wraps the app in `ScopeProvider`, adds the
  `/join-household/:code` route.
- `client/src/components/AppShell.tsx` — adds the `Me / Shared` pill next
  to the existing Live/Demo pill in the header.

New files (no existing counterpart, nothing to overwrite):
- `server/household.ts`
- `server/household-routes.ts`
- `client/src/components/ScopeProvider.tsx`
- `client/src/components/HouseholdScopePill.tsx`
- `client/src/components/HouseholdSettings.tsx`
- `client/src/components/HouseholdNetWorth.tsx`
- `client/src/pages/JoinHousehold.tsx`

## Manual edits (I didn't have full copies of these, so I didn't risk rewriting them)

**1. `server/routes.ts`** — register the household routes. Near the top,
next to the other route imports:

```ts
import { registerHouseholdRoutes } from "./household-routes";
```

Then inside `registerRoutes(httpServer, app)`, anywhere after `app` is
available (e.g. right after the demo-seed blocks, before the Spotify auth
routes is fine):

```ts
registerHouseholdRoutes(app);
```

**2. `server/routes.ts`** — export the two price-fetch helpers so
`household-routes.ts` can reuse them for manual-holdings pricing (they
already exist — used by `/api/portfolio` — just need `export` in front):

```ts
export async function fetchStockPrices(symbols: string[]) { ... }
export async function fetchCryptoPrices(symbols: string[]) { ... }
```

If your actual helper names or return shape differ from
`{ [symbol]: { price, dayChangePct, name } }`, adjust the manual-holdings
block in `server/household-routes.ts`'s `/api/household/net-worth` handler
to match — that's the only place this assumption is used.

**3. `client/src/pages/Settings.tsx`** — render the household card:

```tsx
import { HouseholdSettings } from "@/components/HouseholdSettings";
// ...inside the page body, near your other account-management cards:
<HouseholdSettings />
```

**4. `client/src/pages/Finance.tsx`** (optional but recommended) — show
the combined net worth when scope is Shared:

```tsx
import { HouseholdNetWorth } from "@/components/HouseholdNetWorth";
// ...near the top of the page, above or below the existing net-worth hero:
<HouseholdNetWorth />
```

It renders nothing (`null`) when the user isn't in a household or scope is
"Me", so it's safe to drop in unconditionally.

## What ships vs. what's a template

**Fully wired:** household creation, invite links, join flow, leave flow,
the `Me / Shared` header pill, per-account Finance visibility toggles, and
a combined household net-worth endpoint + card.

**All-or-nothing by design (per your call):** joining a household is one
decision — there's no per-domain toggle for Music/Places/Events/Watch.
Those endpoints currently still query `storage.list*(userId)` for a single
user; they don't yet expand to the household when `scope=shared` is set.
`server/household.ts` exports `getScopedUserIds(userId, scope)` for
exactly this — it resolves to `[userId]` for "me" or every household
member's id for "shared". To extend a domain, e.g. `food_spots` (Places):

```ts
// in the route handler:
const scope = req.query.scope as string | undefined;
const userIds = await getScopedUserIds(req.user!.id, scope);
// then either loop storage.listFoodSpots(id) per id and merge,
// or add a storage.listFoodSpotsForUsers(userIds: number[]) variant
// that does `WHERE user_id IN (...)` directly.
```

Finance was built out fully because it's the highest-stakes, highest-value
domain for a couple. The other four domains are one small loop away from
the same treatment once you've sanity-checked this on Finance.

## Data notes

- SQLite auto-migrates on next server start — the new tables are created
  via `CREATE TABLE IF NOT EXISTS`, no manual migration step.
- Nothing is shared by default. A brand-new household starts with zero
  visible Finance accounts on either side; Music/Places/Events/Watch merge
  fully the moment both people are in the household (per your
  all-or-nothing call), but nothing shares until an invite is actually
  accepted.
- Leaving a household (`POST /api/household/leave`) never deletes data —
  it just removes the `household_members` row.
