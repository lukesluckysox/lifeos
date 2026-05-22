# Life OS

> Everything that makes you, you.

Finance, music, places, events, and film — in one quiet, personal OS. A multi-user, dark-first PWA that pulls your accounts, tastes, and surroundings into a single editorial dashboard.

---

## Table of Contents

- [What's inside](#whats-inside)
- [Architecture](#architecture)
- [Local setup](#local-setup)
- [Environment variables](#environment-variables)
- [Spotify setup](#spotify-setup)
- [Plaid setup](#plaid-setup)
- [Running locally](#running-locally)
- [Building for production](#building-for-production)
- [Deploying to Railway](#deploying-to-railway)
- [Project structure](#project-structure)
- [Conventions](#conventions)
- [Roadmap](#roadmap)

---

## What's inside

Five domains, one canvas. Each card on the landing deck opens into a focused page.

| Domain     | What it shows                                                                     |
| ---------- | --------------------------------------------------------------------------------- |
| **Finance** | Net-worth hero, sentiment engine + lookback pills, Plaid holdings, manual tickers, watchlist, ETF tiles |
| **Music**   | Spotify recently-played, top tracks, audio features, taste fingerprint            |
| **Places**  | City guide — restaurants, neighborhoods, what's on near you                       |
| **Events**  | Live concerts, arts, sports — matched to your artists and city via Ticketmaster   |
| **Watch**   | Rate, save, and discover what to watch next (TMDB)                                |

### Finance: Sentiment Engine + Lookback (new)

Inspired by [StockBought](https://stockbought.streamlit.app) — adapted into Life OS terms.

- **Lookback pills.** A compact row of 1W / 1M / 3M / 6M / 1Y pills sits above the page. Every metric and signal recalculates against the active window — no full-page reload, no per-card slider.
- **Momentum sentiment gauge.** A red → yellow → green gradient with a triangle marker reads the average return across all your holdings for the active lookback. One glance tells you whether your book is leaning bullish or bearish over the window you care about.
- **Buy / sell signal cards.** Two columns, top three each — top-three momentum leaders are flagged "Strong buy / Buy"; bottom three are "Strong sell / Sell". Cached for 5 minutes per `(symbol, weeks)`.

Backend: `GET /api/sentiment/:symbol?weeks=N`, `POST /api/sentiment/batch` — both use Yahoo Finance `v8/finance/chart` (matches the existing `fetchStockPrices` pattern).

---

## Architecture

```
┌─ React 18 + TS + Vite + Tailwind v3 + shadcn ─┐
│  Hash routing (useHashLocation)               │
│  TanStack Query for all server state          │
│  AuthProvider → cookie-backed sessions        │
│  LookbackProvider → context-driven windows    │
└────────────────┬──────────────────────────────┘
                 │ /api/*
┌────────────────▼──────────────────────────────┐
│  Express + better-sqlite3 + Drizzle ORM       │
│  cookie-parser → session middleware           │
│  Spotify OAuth → /api/auth/spotify/*          │
│  Plaid Items → /api/plaid/*                   │
│  Yahoo / Ticketmaster / TMDB → /api/*         │
└───────────────────────────────────────────────┘
```

- **Frontend-heavy.** Most logic lives in React. The backend is a thin proxy that owns secrets and the SQLite DB.
- **Multi-user.** Every per-user table has a `userId` foreign key. The `secrets` table is keyed by `(userId, key)`.
- **Sessions.** HTTP-only, SameSite=Lax cookies, 30-day TTL, SQLite-backed. The original "no storage" rule is enforced inside React (no `localStorage` / `sessionStorage`); cookies are scoped to the server only.
- **Data persistence.** SQLite via `better-sqlite3` — synchronous, file-backed at `data/lifeos.db`. Survives Railway redeploys when you mount a volume.

---

## Local setup

Prereqs: Node 20+, npm 10+.

```bash
git clone https://github.com/lukesluckysox/lifeos.git
cd lifeos
npm install
cp .env.example .env
# fill in secrets — see below
npm run dev
```

Open http://localhost:5000.

---

## Environment variables

All keys live in `.env` (gitignored). `.env.example` is the canonical reference.

| Var                       | Required          | Notes                                                          |
| ------------------------- | ----------------- | -------------------------------------------------------------- |
| `SESSION_SECRET`          | yes               | 32+ random chars. Run `openssl rand -hex 32`.                  |
| `SPOTIFY_CLIENT_ID`       | for music + login | From Spotify dashboard                                         |
| `SPOTIFY_CLIENT_SECRET`   | for music + login | From Spotify dashboard                                         |
| `SPOTIFY_REDIRECT_URI`    | for music + login | Must match dashboard exactly. e.g. `http://localhost:5000/api/auth/spotify/callback` |
| `PLAID_CLIENT_ID`         | for finance       | From Plaid dashboard                                           |
| `PLAID_SECRET`            | for finance       | Per-environment secret                                         |
| `PLAID_ENV`               | for finance       | `sandbox` (default) / `development` (real banks, ≤100 users) / `production` |
| `TICKETMASTER_API_KEY`    | for events        | Free tier OK                                                   |
| `TMDB_API_KEY`            | for watch         | v3 key                                                         |
| `PUBLIC_URL`              | for OAuth         | Your deployed origin. e.g. `https://life.up.railway.app`       |
| `NODE_ENV`                | optional          | `production` flips Express into static-serve mode              |
| `PORT`                    | optional          | Defaults to `5000`                                              |

---

## Spotify setup

1. Open [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) → **Create app**.
2. Set the redirect URI to `http://localhost:5000/api/auth/spotify/callback` (and your deployed equivalent).
3. Required scopes are requested at runtime: `user-read-email`, `user-read-private`, `user-read-recently-played`, `user-top-read`, `user-read-currently-playing`.
4. Copy the Client ID + Secret into `.env`.

The app uses Spotify both as the **login provider** (OAuth) and as a **data source**. The same refresh token powers both.

---

## Plaid setup

1. Open [dashboard.plaid.com](https://dashboard.plaid.com) → grab `client_id` + the secret matching your env.
2. **Default to `PLAID_ENV=sandbox`** while developing. Sandbox uses fake accounts and is free + unlimited.
3. For real bank data, switch to `PLAID_ENV=development` (free up to 100 connected items).
4. Add your domain to **Allowed redirect URIs** in the Plaid dashboard if you use OAuth-based institutions.

Each user connects their bank via the in-app **Connect bank** card → Plaid Link opens → server exchanges the public token at `/api/plaid/exchange` and stores the access token under `(userId, "plaid_access_token")` in `secrets`.

---

## Running locally

```bash
npm run dev          # tsx watch + Vite middleware on :5000
npm run build        # build client + server
npm start            # run prod server: NODE_ENV=production node dist/index.cjs
```

The dev server runs Express and Vite on the same port — frontend HMR plus backend API in one process.

---

## Building for production

```bash
npm run build
NODE_ENV=production node dist/index.cjs
```

Output:

- `dist/public/` — Vite client bundle (HTML + assets)
- `dist/index.cjs` — bundled Express server (esbuild)

---

## Deploying to Railway

The repo ships with `railway.json` + `Procfile`. On a fresh project:

1. Create a new Railway project from `https://github.com/lukesluckysox/lifeos`.
2. Add a **persistent volume** mounted at `/app/data` so the SQLite file survives redeploys.
3. Set every variable from `.env.example` in the Railway → Variables tab. Critically:
   - `PUBLIC_URL` = your Railway public domain.
   - `SPOTIFY_REDIRECT_URI` = `${PUBLIC_URL}/api/auth/spotify/callback` and matches the Spotify dashboard.
4. Update the Spotify and Plaid dashboards with the new redirect / allowed URIs.
5. Push to `main`. Railway runs `npm ci && npm run build`, then `node dist/index.cjs`.

---

## Project structure

```
.
├── client/
│   └── src/
│       ├── components/
│       │   ├── AuthProvider.tsx          # cookie session + login/logout
│       │   ├── PlaidConnect.tsx          # Plaid Link card
│       │   ├── SentimentEngine.tsx       # gauge + buy/sell columns
│       │   ├── LookbackContext.tsx       # global lookback (weeks)
│       │   └── LookbackPills.tsx         # 1W / 1M / 3M / 6M / 1Y pills
│       └── pages/
│           ├── Landing.tsx               # 5-card fan + ENTER button
│           ├── Finance.tsx               # net-worth, sentiment, holdings
│           ├── Home.tsx                  # 5-card dashboard (post-login)
│           ├── Music.tsx                 # Spotify
│           ├── Places.tsx                # City guide
│           ├── Events.tsx                # Ticketmaster
│           └── Watch.tsx                 # TMDB
├── server/
│   ├── auth.ts                           # Spotify OAuth + sessions
│   ├── plaid.ts                          # Plaid client + token exchange
│   ├── routes.ts                         # all /api/* endpoints
│   ├── storage.ts                        # Drizzle queries
│   └── index.ts                          # Express bootstrap
├── shared/
│   └── schema.ts                         # users, sessions, secrets, holdings
├── .env.example
├── railway.json
├── Procfile
└── README.md
```

---

## Conventions

These are hard rules — drift from them and the build breaks.

- **Dark-first editorial sparse premium aesthetic.** No noisy gradients, no oversized headings, no AI slop.
- **Hash routing only.** `<Router hook={useHashLocation}>` from `wouter/use-hash-location`. Every link is a hash path.
- **`useLocation as useCity`.** Renamed import for the Places page so wouter's `useLocation` doesn't shadow it.
- **Tailwind v3.** No `@theme`, no v4 syntax. `@tailwind base/components/utilities` directives only.
- **`--text-xl` is the max heading size.** Nothing larger inside the app shell.
- **No client-side storage.** No `localStorage`, `sessionStorage`, or `indexedDB` in React code — they're blocked in the iframe sandbox. HTTP-only cookies on the server are the one exception (auth requires it).
- **`data-testid` on every interactive element.** `{action}-{target}` for controls, `{type}-{content}` for displays.
- **`apiRequest` from `@/lib/queryClient`** for all HTTP — never raw `fetch()`.

---

## Roadmap

Already wired:

- Multi-user auth via Spotify OAuth
- Plaid Link + per-user access tokens
- Net-worth hero + manual tickers + Plaid holdings
- **Sentiment engine** with momentum gauge and buy/sell signal cards
- **Global lookback pills** (1W → 1Y)
- Refresh button in the app shell that invalidates active queries

Next, in priority order:

1. **Performance-weighted optimal allocation donut** — re-weight your book against momentum, plus a "what would $1k do" simulator.
2. **Click-to-chart inline ETF tiles** — tap any ticker to expand a sparkline + 1-week / 1-month / YTD micro-chart in place.
3. **Category Leaders trophy cards** — top performer per sector, expandable to a Top-10 list.
4. Manual-token revocation flow + per-connection "last synced" stamp.
5. Push notifications for sentiment threshold crossings.

---

## License

Private — all rights reserved.
