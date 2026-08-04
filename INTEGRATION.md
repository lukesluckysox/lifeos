# Shared View — integration guide

This folder mirrors `lifeos`'s real paths. Drop each file into your clone at
the matching path and overwrite. Two files below are **full replacements**
you already have originals of; the rest are **new files** with no existing
counterpart, plus three small manual edits to files I didn't have complete
copies of (so I didn't touch them blind).

## Files to drop in (same relative paths as the repo)

Full replacements (safe — built from your actual current file contents):
- `server/storage.ts` — adds `households`, `household_members`,
  `household_invites`, `account_visibility`, `household_domain_shares`,
  and `cash_accounts` tables + CRUD methods.
- `client/src/App.tsx` — wraps the app in `ScopeProvider`, adds the
  `/join-household/:code` route.
- `client/src/components/AppShell.tsx` — adds the `Me / Shared` pill next
  to the existing Live/Demo pill in the header.
- `client/src/components/Logo.tsx` — rebrand ("Radius" → "LifeOS") plus
  the sidebar wordmark now shows "together" underneath itself whenever
  scope is Shared (works anywhere `<Wordmark />` renders, since
  `ScopeProvider` wraps the whole app including the pre-auth Landing page).
- `client/src/pages/Home.tsx` — folds the manual cash-accounts total into
  the Finance card's net worth number, and picks up the LifeOS rebrand in
  its footer/onboarding copy.
- `client/src/pages/Flights.tsx` — swaps the old flat-SVG `ArcMap` for
  the new geodesic `FlightPathsMap`. See "Flight paths map" below —
  everything else in the file is untouched.
- `client/src/pages/Finance.tsx` — three changes, everything else
  (allocation, index comparison, manual holdings, watchlist, Advisor
  tab) untouched: (1) the old read-only "Connected brokerages" strip
  is now `<ConnectedAccountsTray />` — same spot, same chip styling,
  now with savings-account chips and a "+ Add savings account" pill
  alongside the brokerage chips; (2) `usePortfolio()` folds included
  cash balances into `netWorth` plus a "Cash" metric next to
  Plaid/Manual; (3) `<HouseholdNetWorth />` is now dropped in directly
  (see manual edit #4 below — no longer manual, it's in this file).

New files (no existing counterpart, nothing to overwrite):
- `server/household.ts`
- `server/household-routes.ts`
- `server/cash-accounts-routes.ts`
- `client/src/components/ScopeProvider.tsx`
- `client/src/components/HouseholdScopePill.tsx`
- `client/src/components/HouseholdSettings.tsx`
- `client/src/components/HouseholdNetWorth.tsx`
- `client/src/components/HouseholdMusic.tsx`
- `client/src/components/HouseholdConcerts.tsx`
- `client/src/components/ConnectedAccountsTray.tsx` — the actual cash-account UI, drop-in-ready (already imported by the `Finance.tsx` replacement above).
- `client/src/pages/JoinHousehold.tsx`

**Ignore `client/src/components/CashAccounts.tsx`.** It was an earlier
standalone card version of the cash-accounts UI, built before I knew
where you wanted it. You asked for savings accounts to show "in the
tray where it says the brokerages connected" — that's
`ConnectedAccountsTray.tsx` above, already wired into `Finance.tsx` in
that exact spot. `CashAccounts.tsx` is redundant with it now; don't
drop it in.

Note: I did NOT touch `Home.tsx`'s footer link text or the
`radius-export-*.json` export filename beyond the one "Radius" → "LifeOS"
swap already in the footer — there's likely at least one more "Radius"
reference in `Settings.tsx` (export button copy) I haven't seen. Grep
your repo for `Radius` once these are in to catch anything I couldn't see.

## Flight paths map

**Correction from an earlier version of this doc:** I originally
hedged on whether flight routes already existed in your real
`routes.ts`. I've now seen your actual `client/src/pages/Flights.tsx`
directly — they do. Your app already has a complete, working flight
log: `/api/flights` (GET/POST/DELETE), full `BoardingPassScanner`
integration, stats cards, a by-year mileage breakdown, and its own map
component (`ArcMap`) using a flat SVG equirectangular projection with a
~50-airport lookup. None of that needs to be built — **ignore
`server/flight-legs-routes.ts` entirely; do not register it.** It
targeted a `/api/flight-legs` path that doesn't exist and isn't needed.
It's included in this folder only because I built it speculatively
before I'd seen the real file — delete it or leave it unused, your call.

What's actually worth taking from this folder is just the map upgrade:

- `client/src/lib/airports.ts` — curated IATA-code → lat/lon lookup
  (~180 major hubs, more than the ~50 your existing `ArcMap` has built
  in). Add entries here for any airport the map reports as unresolved.
- `client/src/components/FlightPathsMap.tsx` — draws real great-circle
  arcs (not straight lines) between airports using `react-leaflet` +
  the same free CartoDB dark tiles `PathsMap.tsx` already uses. No new
  library, no API key. This replaces `ArcMap`'s flat SVG projection
  with an actual geodesic map, consistent with the map on your Places
  page.

**`client/src/pages/Flights.tsx` — full replacement**, built from your
real file. The only functional change: swapped the old
`{legs.length > 0 && <ArcMap legs={legs} />}` render for
`<FlightPathsMap flights={mapFlights} />`, where `mapFlights` is a small
inline adapter mapping your `FlightLeg`'s snake_case fields
(`departure_date`, `flight_number`) to `FlightPathsMap`'s prop shape
(`date`, `flightNumber`). The old `ArcMap` function definition is
removed. `AIRPORT_COORDS`, `haversineKm`, and `estimateMiles` are all
**kept as-is** — they're still used for the "≈ X miles estimated" text
on the add-flight form and for the mileage stats/by-year breakdown,
which are unrelated to the map itself. Everything else in the file
(BoardingPassScanner, the add form, stats, by-year bars, flight list,
delete) is untouched, byte-for-byte.

**Not built (small follow-up if you want it later):** merging both
household members' flights onto one shared map, the same way Music and
Events merge now — add `"flights"` to `SHARABLE_DOMAINS` in
`household-routes.ts` and follow the Music/Events handlers as a
template; `FlightPathsMap`'s `sharedBy` field on each leg is already
there waiting for it (shows in the route tooltip).

## Native visited-places (replaces the Atlas/Trace connection)

Two new files:

- `server/storage.ts` (already updated above) — adds a `visited_places`
  table + CRUD methods.
- `server/visited-places-routes.ts` — `GET/POST/PATCH/DELETE
  /api/visited-places`, response shaped to match `PathsMap.tsx`'s
  existing `MapPath` type exactly. Register it the same way as the
  others: `import { registerVisitedPlaceRoutes } from
  "./visited-places-routes";` then `registerVisitedPlaceRoutes(app);`.

**Full replacement:** `client/src/pages/Places.tsx` — this is the real
integration. I had complete visibility into this file, so rather than
handing you a bolt-on component, I replaced `AtlasPathsSection` (the
part that fetched from `/api/paths` and showed "Connect Atlas") with
`VisitedPlacesSection` in the *exact same spot* on the page — same map,
same filter chips with counts, same pagination, plus a "Log a place"
button that expands an inline form (type picker, name, a location search
reusing the same `/api/places/city-search` endpoint AppShell's city
picker already uses — no new geocoding dependency — date, note).

Dropped from the old cards since native `visited_places` doesn't capture
them (kept out on purpose, per the "just native logging" scope): photo,
weather, moon phase, and the "view on Atlas" link. Everything else —
map, filters, pagination, card layout — is identical to before.

**Ignore the earlier `client/src/components/VisitedPlaces.tsx` file** —
it was a standalone version built before I'd seen your real `Places.tsx`.
It's now superseded by the direct integration above; don't drop it in,
it's redundant with what's already inline in the new `Places.tsx`.

**Left alone on purpose:** the `atlas_links` table, `/api/atlas/*`
routes, and `/api/paths` endpoint in your real `routes.ts` still exist
and still work — I didn't touch or remove them. They're just unused by
the Places page now. Clean them up whenever you're confident the native
version is solid; no rush, they're harmless sitting idle. The "Atlas ·
the sibling app" link in `Home.tsx`'s footer is also untouched — that's
a separate call about whether you still want to point people at Atlas
as its own product.

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

**4. `client/src/pages/Finance.tsx`** — no manual step needed anymore.
The full-replacement file above already imports and renders
`<HouseholdNetWorth />` (right below the connected-accounts tray,
above the net-worth hero) — it's self-gating and renders nothing
outside Shared scope.

**5. `client/src/pages/Music.tsx`** — show the merged listening feed:

```tsx
import { HouseholdMusic } from "@/components/HouseholdMusic";
// drop in wherever "recently played" or "top tracks" currently render —
// pass section="top" for a top-tracks version:
<HouseholdMusic section="recent" />
```

**6. `client/src/pages/Events.tsx`** — show the merged concert matches:

```tsx
import { HouseholdConcerts } from "@/components/HouseholdConcerts";
<HouseholdConcerts />
```

All four Household* components (`HouseholdNetWorth`, `HouseholdMusic`,
`HouseholdConcerts`, and the Settings card) render nothing (`null`) when
the user isn't in a household or scope is "Me", so every one of them is
safe to drop in unconditionally — no conditional wrapping needed at the
call site.

## What ships vs. what's a template

**Fully wired:** household creation, invite links, join flow, leave flow,
the `Me / Shared` header pill (the **parent** switch), per-account Finance
visibility toggles (opt-in), and per-domain Music/Events sharing toggles
in Settings (opt-out — the **individual** layer under the parent switch).
Backed by real merged endpoints:

- `/api/household/net-worth` — combined Plaid + manual holdings, gated by
  `account_visibility` (Finance stays opt-in: nothing shows until turned on).
- `/api/household/music` — merges each opted-in member's own live
  Spotify recent/top tracks + pinned tracks, tagged with who it's from.
- `/api/household/concerts-for-you` — merges artist taste across opted-in
  members, then re-runs the Ticketmaster match once for the combined list.

**Not built — by your call, not by omission:** Places and Watch don't
merge. `server/household.ts` still exports `getScopedUserIds(userId,
scope)` if you change your mind later — it resolves to `[userId]` for
"me" or every household member's id for "shared", the same primitive
Music/Events sharing is built on. To extend a new domain to the
opt-out toggle model, add its name to `SHARABLE_DOMAINS` in
`server/household-routes.ts` and follow the Music/Events handlers as a
template (loop household members, skip ones who opted out via
`storage.getDomainShareSettings`, merge, tag with `sharedBy`).

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
