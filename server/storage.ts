import { users, sessions, ratings, holdings, watchlist, subscriptions, foodSpots, recFeedback, userItems, secrets, plaidItems, atlasLinks } from '@shared/schema';
import type {
  User,
  Session,
  Rating, InsertRating,
  Holding, InsertHolding,
  Watchlist, InsertWatchlist,
  Subscription, InsertSubscription,
  FoodSpot, InsertFoodSpot,
  RecFeedback, InsertRecFeedback,
  UserItem, InsertUserItem,
  PlaidItem,
  AtlasLink,
} from '@shared/schema';
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { eq, and, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";

// Resolve DB path:
// - Production (Railway): point DB_PATH at a persistent volume
//   (e.g. DB_PATH=/data/data.db with a volume mounted at /data).
//   Without this, EVERY redeploy wipes data.db — sessions, manual
//   holdings, Plaid item references, watchlist, all gone.
// - Local dev: defaults to ./data.db in the working directory.
const DB_PATH = process.env.DB_PATH || "data.db";
try { mkdirSync(dirname(DB_PATH), { recursive: true }); } catch {}
const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");

// ──────────────────────────────────────────────────────────────────────────────
// Migration: detect old schema (no user_id columns) and drop/recreate tables.
// ──────────────────────────────────────────────────────────────────────────────
function hasColumn(table: string, column: string): boolean {
  try {
    const cols = sqlite.pragma(`table_info(${table})`);
    return (cols as any[]).some((c: any) => c.name === column);
  } catch {
    return false;
  }
}

const perUserTables = ["ratings", "holdings", "watchlist", "subscriptions", "food_spots", "rec_feedback", "user_items", "secrets"];
for (const t of perUserTables) {
  const col = t === "secrets" ? "user_id" : "user_id";
  if (tableExists(t) && !hasColumn(t, col)) {
    console.warn(`[storage] Migration: table "${t}" is missing user_id — dropping and recreating. Existing data will be lost (first-time schema migration).`);
    try {
      sqlite.exec(`DROP TABLE IF EXISTS "${t}"`);
    } catch (e: any) {
      console.error(`[storage] Failed to drop table "${t}":`, e.message);
    }
  }
}

function tableExists(name: string): boolean {
  try {
    const row = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
    return !!row;
  } catch {
    return false;
  }
}

// Full schema bootstrap
sqlite.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password TEXT,
  spotify_id TEXT UNIQUE,
  google_id TEXT UNIQUE,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  created_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  signal INTEGER NOT NULL,
  meta TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ratings_kind_external ON ratings(kind, external_id);
CREATE INDEX IF NOT EXISTS idx_ratings_user ON ratings(user_id);
CREATE TABLE IF NOT EXISTS holdings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT,
  quantity REAL NOT NULL,
  cost_basis REAL NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_holdings_kind ON holdings(kind);
CREATE INDEX IF NOT EXISTS idx_holdings_user ON holdings(user_id);
CREATE TABLE IF NOT EXISTS watchlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_watchlist_kind ON watchlist(kind);
CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id);
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  amount REAL NOT NULL,
  cadence TEXT NOT NULL,
  category TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  next_charge TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_source ON subscriptions(source);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE TABLE IF NOT EXISTS food_spots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  category TEXT,
  note TEXT,
  url TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_food_spots_city ON food_spots(city);
CREATE INDEX IF NOT EXISTS idx_food_spots_source ON food_spots(source);
CREATE INDEX IF NOT EXISTS idx_food_spots_user ON food_spots(user_id);
CREATE TABLE IF NOT EXISTS rec_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  external_id TEXT NOT NULL,
  signal INTEGER NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rec_feedback_kind_ext ON rec_feedback(kind, external_id);
CREATE INDEX IF NOT EXISTS idx_rec_feedback_user ON rec_feedback(user_id);
CREATE TABLE IF NOT EXISTS user_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  url TEXT,
  meta TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_items_kind ON user_items(kind);
CREATE INDEX IF NOT EXISTS idx_user_items_user ON user_items(user_id);
CREATE TABLE IF NOT EXISTS secrets (
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);
CREATE TABLE IF NOT EXISTS plaid_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  institution_name TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plaid_items_user ON plaid_items(user_id);

CREATE TABLE IF NOT EXISTS user_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  card_id TEXT NOT NULL,
  nickname TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_cards_user ON user_cards(user_id);
CREATE TABLE IF NOT EXISTS flight_legs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  origin_name TEXT,
  destination_name TEXT,
  airline TEXT,
  flight_number TEXT,
  departure_date TEXT NOT NULL,
  cabin TEXT,
  miles INTEGER,
  notes TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_flight_legs_user ON flight_legs(user_id);
CREATE TABLE IF NOT EXISTS net_worth_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  value REAL NOT NULL,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nw_user ON net_worth_entries(user_id);
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  target REAL NOT NULL,
  current REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL,
  deadline TEXT,
  notes TEXT,
  completed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_goals_user ON goals(user_id);

CREATE TABLE IF NOT EXISTS atlas_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  atlas_user_id TEXT NOT NULL,
  atlas_username TEXT,
  atlas_name TEXT,
  connected_at INTEGER NOT NULL
);

-- ── Household — shared-view infrastructure for couples ──────────────────
-- A household is a small group (v1: designed for two) whose members can
-- opt into a combined "Shared" view of their data. Joining a household is
-- all-or-nothing for the non-finance domains (Music/Places/Events/Watch);
-- Finance gets its own per-account visibility layer below because the
-- stakes of accidentally exposing a balance are higher than a watchlist.
CREATE TABLE IF NOT EXISTS households (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  created_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
-- user_id is UNIQUE: one household per user in v1 (matches the couple
-- use case). Relax this later if households need to support more than
-- one group per person.
CREATE TABLE IF NOT EXISTS household_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL UNIQUE,
  joined_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_household_members_household ON household_members(household_id);
CREATE TABLE IF NOT EXISTS household_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL,
  code TEXT NOT NULL UNIQUE,
  created_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  used_by INTEGER
);
CREATE INDEX IF NOT EXISTS idx_household_invites_code ON household_invites(code);
-- Per-account, per-owner visibility flag for the Finance domain only.
-- account_type is "plaid_item" (account_ref = plaid_items.item_id) or
-- "manual" (account_ref is always the literal "manual" — the whole
-- hand-entered holdings bucket toggles as one unit in v1). Absence of a
-- row means NOT visible — sharing is opt-in, not opt-out.
CREATE TABLE IF NOT EXISTS account_visibility (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  account_type TEXT NOT NULL,
  account_ref TEXT NOT NULL,
  visible INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  UNIQUE(household_id, user_id, account_type, account_ref)
);
CREATE INDEX IF NOT EXISTS idx_account_visibility_household ON account_visibility(household_id);
-- Per-user, per-domain sharing switch for the LOW-stakes domains (Music,
-- Events). Unlike account_visibility (Finance, opt-IN — absent row means
-- hidden), this is opt-OUT: absent row means shared=true. Joining a
-- household shares Music/Events by default; a member can flip a domain
-- off here without leaving the household. This is the "individual"
-- layer underneath the household-level "parent" Shared toggle.
CREATE TABLE IF NOT EXISTS household_domain_shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  domain TEXT NOT NULL,
  shared INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  UNIQUE(household_id, user_id, domain)
);
CREATE INDEX IF NOT EXISTS idx_household_domain_shares_household ON household_domain_shares(household_id);

-- Manual cash / savings accounts — balances with no ticker and no price
-- feed (a local credit union account, a brokerage that won't connect via
-- Plaid, cash under the mattress). Just a name and a balance you update
-- by hand, with a switch for whether it counts toward the overall
-- portfolio total. No quantity/cost-basis columns on purpose — this
-- isn't priced, it's just tracked.
CREATE TABLE IF NOT EXISTS cash_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  institution TEXT,
  balance REAL NOT NULL DEFAULT 0,
  include_in_portfolio INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cash_accounts_user ON cash_accounts(user_id);

-- Visited places — native replacement for the Atlas "Experience"/Path
-- concept. Same shape PathsMap.tsx already expects (type, name,
-- location, lat/lon), logged directly in LifeOS instead of fetched via
-- the Atlas OAuth connect flow. type is freeform text but the known set
-- rendered with dedicated colors in PathsMap.tsx is: national_park,
-- state, country, stadium, concert, beach — anything else falls back to
-- PathsMap's DEFAULT_COLOR.
CREATE TABLE IF NOT EXISTS visited_places (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  location TEXT,
  latitude REAL,
  longitude REAL,
  visited_date TEXT,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_visited_places_user ON visited_places(user_id);
`);

// Forward-compat: CREATE TABLE IF NOT EXISTS doesn't add columns to an
// already-existing table. For each additive column we add over time, run
// an idempotent ALTER TABLE that swallows the duplicate-column error.
function safeAddColumn(table: string, definition: string) {
  try {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  } catch (e: any) {
    // SQLite throws "duplicate column name" when the column already exists.
    // Anything else, let it bubble.
    if (!/duplicate column/i.test(e.message || "")) throw e;
  }
}
safeAddColumn("users", "google_id TEXT");
safeAddColumn("users", "onboarding_completed INTEGER DEFAULT 0");
// Index can't be on UNIQUE retroactively in SQLite without rebuilding
// the table, but a partial unique index gives us uniqueness for non-null
// google_id values, which is what we actually need.
try {
  sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL");
} catch {}

// One-time cleanup: merge duplicate users that share the same email but ended
// up as separate rows because the Spotify callback did not cross-link by
// email. Re-points all owned data (plaid_items, holdings, watchlist,
// subscriptions, food_spots, rec_feedback, user_items, secrets, ratings,
// sessions, spotify refresh tokens, manual cost basis) at the oldest user
// id and then deletes the duplicates.
function mergeDuplicateUsersByEmail() {
  try {
    const dupes = sqlite
      .prepare(
        `SELECT email, MIN(id) as keepId, GROUP_CONCAT(id) as allIds, COUNT(*) as n
         FROM users
         WHERE email IS NOT NULL AND email != ''
         GROUP BY email
         HAVING n > 1`
      )
      .all() as Array<{ email: string; keepId: number; allIds: string; n: number }>;

    if (dupes.length === 0) return;

    const ownedTables = [
      "plaid_items",
      "holdings",
      "watchlist",
      "subscriptions",
      "food_spots",
      "rec_feedback",
      "user_items",
      "secrets",
      "ratings",
      "sessions",
    ];

    const tx = sqlite.transaction(() => {
      for (const d of dupes) {
        const ids = d.allIds.split(",").map(Number).filter(id => id !== d.keepId);
        const keep = d.keepId;

        // Re-point owned rows to the surviving user.
        for (const t of ownedTables) {
          try {
            sqlite.prepare(`UPDATE ${t} SET user_id = ? WHERE user_id IN (${ids.join(",")})`).run(keep);
          } catch {
            // Table may not exist on older deploys — ignore.
          }
        }

        // Merge the auth identity columns onto the survivor so future
        // sign-ins (Google or Spotify) resolve to the same row.
        const others = sqlite
          .prepare(`SELECT spotify_id, google_id, display_name, avatar_url FROM users WHERE id IN (${ids.join(",")})`)
          .all() as any[];
        const merged: Record<string, any> = {};
        for (const o of others) {
          if (o.spotify_id && !merged.spotify_id) merged.spotify_id = o.spotify_id;
          if (o.google_id && !merged.google_id) merged.google_id = o.google_id;
          if (o.display_name && !merged.display_name) merged.display_name = o.display_name;
          if (o.avatar_url && !merged.avatar_url) merged.avatar_url = o.avatar_url;
        }
        // Only overwrite survivor fields that are currently NULL.
        const survivor = sqlite.prepare(`SELECT * FROM users WHERE id = ?`).get(keep) as any;
        const patch: Record<string, any> = {};
        if (!survivor.spotify_id && merged.spotify_id) patch.spotify_id = merged.spotify_id;
        if (!survivor.google_id && merged.google_id) patch.google_id = merged.google_id;
        if (!survivor.display_name && merged.display_name) patch.display_name = merged.display_name;
        if (!survivor.avatar_url && merged.avatar_url) patch.avatar_url = merged.avatar_url;
        const keys = Object.keys(patch);
        if (keys.length) {
          const setClause = keys.map(k => `${k} = ?`).join(", ");
          sqlite.prepare(`UPDATE users SET ${setClause} WHERE id = ?`).run(...keys.map(k => patch[k]), keep);
        }

        // Finally delete the duplicate user rows.
        sqlite.prepare(`DELETE FROM users WHERE id IN (${ids.join(",")})`).run();

        console.log(`[merge-users] merged ${ids.length} duplicate(s) of ${d.email} into user ${keep}`);
      }
    });
    tx();
  } catch (e: any) {
    console.error("[merge-users] failed:", e.message);
  }
}
mergeDuplicateUsersByEmail();

export const db = drizzle(sqlite);

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserBySpotifyId(spotifyId: string): Promise<User | undefined>;
  getUserByGoogleId(googleId: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  updateUser(id: number, patch: { googleId?: string; spotifyId?: string; displayName?: string; avatarUrl?: string; onboardingCompleted?: number }): Promise<User | undefined>;
  createUser(user: { username?: string; password?: string; spotifyId?: string; googleId?: string; email?: string; displayName?: string; avatarUrl?: string }): Promise<User>;

  createSession(userId: number): Promise<{ id: string; expiresAt: number }>;
  getSessionUser(sessionId: string): Promise<User | null>;
  deleteSession(sessionId: string): Promise<void>;

  listRatings(userId: number, kind?: string): Promise<Rating[]>;
  upsertRating(userId: number, r: InsertRating): Promise<Rating>;
  removeRating(userId: number, kind: string, externalId: string): Promise<{ changes: number }>;

  listHoldings(userId: number, kind?: string): Promise<Holding[]>;
  addHolding(userId: number, h: InsertHolding): Promise<Holding>;
  updateHolding(userId: number, id: number, patch: Partial<InsertHolding>): Promise<Holding | undefined>;
  removeHolding(userId: number, id: number): Promise<{ changes: number }>;

  listWatchlist(userId: number, kind?: string): Promise<Watchlist[]>;
  addWatchlist(userId: number, w: InsertWatchlist): Promise<Watchlist>;
  removeWatchlist(userId: number, id: number): Promise<{ changes: number }>;

  listSubscriptions(userId: number): Promise<Subscription[]>;
  addSubscription(userId: number, s: InsertSubscription): Promise<Subscription>;
  removeSubscription(userId: number, id: number): Promise<{ changes: number }>;

  listFoodSpots(userId: number, q?: { city?: string; query?: string; source?: string }): Promise<FoodSpot[]>;
  addFoodSpot(userId: number, f: InsertFoodSpot): Promise<FoodSpot>;
  removeFoodSpot(userId: number, id: number): Promise<{ changes: number }>;

  listRecFeedback(userId: number, kind?: string): Promise<RecFeedback[]>;
  upsertRecFeedback(userId: number, f: InsertRecFeedback): Promise<RecFeedback>;
  removeRecFeedback(userId: number, kind: string, externalId: string): Promise<{ changes: number }>;

  listUserItems(userId: number, kind?: string): Promise<UserItem[]>;
  addUserItem(userId: number, u: InsertUserItem): Promise<UserItem>;
  removeUserItem(userId: number, id: number): Promise<{ changes: number }>;

  getSecret(userId: number, key: string): Promise<string | undefined>;
  setSecret(userId: number, key: string, value: string): Promise<void>;

  savePlaidItem(userId: number, item: { itemId: string; accessToken: string; institutionName?: string }): Promise<PlaidItem>;
  getPlaidItems(userId: number): Promise<PlaidItem[]>;
  deletePlaidItem(userId: number, itemId: string): Promise<{ changes: number }>;

  // Atlas link (per-user mapping to an Atlas userId)
  getAtlasLink(userId: number): Promise<AtlasLink | undefined>;
  upsertAtlasLink(userId: number, atlasUserId: string, atlasUsername: string | null, atlasName: string | null): Promise<AtlasLink>;
  deleteAtlasLink(userId: number): Promise<{ changes: number }>;

  /**
   * Permanently delete a user and all of their associated data.
   * Used by the Settings > Delete account flow. Returns the number of
   * top-level rows removed (1 if the user existed, 0 otherwise).
   */
  deleteUserAndAllData(userId: number): Promise<{ changes: number }>;
}

export class DatabaseStorage implements IStorage {
  // ── User Cards ──────────────────────────────────────────────────────────
  async listUserCards(userId: number): Promise<any[]> {
    return sqlite.prepare("SELECT * FROM user_cards WHERE user_id = ? ORDER BY created_at DESC").all(userId) as any[];
  }
  async addUserCard(userId: number, cardId: string, nickname?: string): Promise<any> {
    const now = Date.now();
    const result = sqlite.prepare(
      "INSERT INTO user_cards (user_id, card_id, nickname, created_at) VALUES (?, ?, ?, ?)"
    ).run(userId, cardId, nickname ?? null, now);
    return { id: result.lastInsertRowid, userId, cardId, nickname, createdAt: now };
  }
  async removeUserCard(userId: number, id: number): Promise<{ changes: number }> {
    const result = sqlite.prepare("DELETE FROM user_cards WHERE id = ? AND user_id = ?").run(id, userId);
    return { changes: result.changes };
  }

  // ── Flight Legs ──────────────────────────────────────────────────────────
  async listFlightLegs(userId: number): Promise<any[]> {
    return sqlite.prepare("SELECT * FROM flight_legs WHERE user_id = ? ORDER BY departure_date DESC").all(userId) as any[];
  }
  async addFlightLeg(userId: number, leg: {
    origin: string; destination: string; originName?: string; destinationName?: string;
    airline?: string; flightNumber?: string; departureDate: string;
    cabin?: string; miles?: number; notes?: string;
  }): Promise<any> {
    const now = Date.now();
    const result = sqlite.prepare(`
      INSERT INTO flight_legs (user_id, origin, destination, origin_name, destination_name,
        airline, flight_number, departure_date, cabin, miles, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, leg.origin.toUpperCase(), leg.destination.toUpperCase(),
      leg.originName ?? null, leg.destinationName ?? null,
      leg.airline ?? null, leg.flightNumber ?? null, leg.departureDate,
      leg.cabin ?? null, leg.miles ?? null, leg.notes ?? null, now);
    return { id: result.lastInsertRowid, ...leg, userId, createdAt: now };
  }
  async removeFlightLeg(userId: number, id: number): Promise<{ changes: number }> {
    const result = sqlite.prepare("DELETE FROM flight_legs WHERE id = ? AND user_id = ?").run(id, userId);
    return { changes: result.changes };
  }

  // ── Net Worth Entries ────────────────────────────────────────────────────
  async listNetWorthEntries(userId: number): Promise<any[]> {
    return sqlite.prepare("SELECT * FROM net_worth_entries WHERE user_id = ? ORDER BY kind, label").all(userId) as any[];
  }
  async upsertNetWorthEntry(userId: number, entry: {
    id?: number; kind: string; label: string; value: number; notes?: string;
  }): Promise<any> {
    const now = Date.now();
    if (entry.id) {
      sqlite.prepare(`
        UPDATE net_worth_entries SET kind=?, label=?, value=?, notes=?, updated_at=?
        WHERE id=? AND user_id=?
      `).run(entry.kind, entry.label, entry.value, entry.notes ?? null, now, entry.id, userId);
      return { ...entry, userId, updatedAt: now };
    }
    const result = sqlite.prepare(`
      INSERT INTO net_worth_entries (user_id, kind, label, value, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, entry.kind, entry.label, entry.value, entry.notes ?? null, now, now);
    return { id: result.lastInsertRowid, ...entry, userId, createdAt: now, updatedAt: now };
  }
  async removeNetWorthEntry(userId: number, id: number): Promise<{ changes: number }> {
    const result = sqlite.prepare("DELETE FROM net_worth_entries WHERE id = ? AND user_id = ?").run(id, userId);
    return { changes: result.changes };
  }

  // ── Goals ─────────────────────────────────────────────────────────────────
  async listGoals(userId: number): Promise<any[]> {
    return sqlite.prepare("SELECT * FROM goals WHERE user_id = ? ORDER BY completed ASC, deadline ASC, created_at DESC").all(userId) as any[];
  }
  async addGoal(userId: number, goal: {
    title: string; category: string; targetValue: number; currentValue?: number;
    unit: string; deadline?: string; notes?: string;
  }): Promise<any> {
    const now = Date.now();
    const result = sqlite.prepare(`
      INSERT INTO goals (user_id, title, category, target_value, current_value, unit, deadline, notes, completed, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(userId, goal.title, goal.category, goal.targetValue, goal.currentValue ?? 0,
      goal.unit, goal.deadline ?? null, goal.notes ?? null, now, now);
    return { id: result.lastInsertRowid, ...goal, userId, completed: 0, createdAt: now, updatedAt: now };
  }
  async updateGoal(userId: number, id: number, patch: {
    title?: string; category?: string; targetValue?: number; currentValue?: number;
    unit?: string; deadline?: string; notes?: string; completed?: number;
  }): Promise<any> {
    const now = Date.now();
    const existing: any = sqlite.prepare("SELECT * FROM goals WHERE id = ? AND user_id = ?").get(id, userId);
    if (!existing) return undefined;
    const merged = { ...existing, ...patch, updated_at: now };
    sqlite.prepare(`
      UPDATE goals SET title=?, category=?, target_value=?, current_value=?, unit=?,
        deadline=?, notes=?, completed=?, updated_at=? WHERE id=? AND user_id=?
    `).run(merged.title, merged.category, merged.target_value ?? patch.targetValue ?? existing.target_value,
      merged.current_value ?? patch.currentValue ?? existing.current_value,
      merged.unit, merged.deadline ?? null, merged.notes ?? null,
      merged.completed ?? 0, now, id, userId);
    return { ...merged, id };
  }
  async removeGoal(userId: number, id: number): Promise<{ changes: number }> {
    const result = sqlite.prepare("DELETE FROM goals WHERE id = ? AND user_id = ?").run(id, userId);
    return { changes: result.changes };
  }

  async deleteUserAndAllData(userId: number): Promise<{ changes: number }> {
    // Order matters: delete children before the user row. Sessions and
    // secrets are keyed by user_id, holdings/watchlist/etc. likewise.
    db.delete(sessions).where(eq(sessions.userId, userId)).run();
    db.delete(plaidItems).where(eq(plaidItems.userId, userId)).run();
    db.delete(ratings).where(eq(ratings.userId, userId)).run();
    db.delete(holdings).where(eq(holdings.userId, userId)).run();
    db.delete(watchlist).where(eq(watchlist.userId, userId)).run();
    db.delete(subscriptions).where(eq(subscriptions.userId, userId)).run();
    db.delete(foodSpots).where(eq(foodSpots.userId, userId)).run();
    db.delete(recFeedback).where(eq(recFeedback.userId, userId)).run();
    db.delete(userItems).where(eq(userItems.userId, userId)).run();
    db.delete(secrets).where(eq(secrets.userId, userId)).run();
    // Household membership shouldn't outlive the account either.
    sqlite.prepare("DELETE FROM household_members WHERE user_id = ?").run(userId);
    sqlite.prepare("DELETE FROM account_visibility WHERE user_id = ?").run(userId);
    sqlite.prepare("DELETE FROM household_domain_shares WHERE user_id = ?").run(userId);
    sqlite.prepare("DELETE FROM cash_accounts WHERE user_id = ?").run(userId);
    sqlite.prepare("DELETE FROM visited_places WHERE user_id = ?").run(userId);
    const r = db.delete(users).where(eq(users.id, userId)).run();
    return { changes: r.changes };
  }

  async getUser(id: number): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.id, id)).get();
  }
  async getUserByUsername(username: string): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.username, username)).get();
  }
  async getUserBySpotifyId(spotifyId: string): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.spotifyId, spotifyId)).get();
  }
  async getUserByGoogleId(googleId: string): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.googleId, googleId)).get();
  }
  async getUserByEmail(email: string): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.email, email)).get();
  }
  async updateUser(id: number, patch: { googleId?: string; spotifyId?: string; displayName?: string; avatarUrl?: string; onboardingCompleted?: number }): Promise<User | undefined> {
    const set: Record<string, any> = {};
    if (patch.googleId !== undefined) set.googleId = patch.googleId;
    if (patch.spotifyId !== undefined) set.spotifyId = patch.spotifyId;
    if (patch.displayName !== undefined) set.displayName = patch.displayName;
    if (patch.avatarUrl !== undefined) set.avatarUrl = patch.avatarUrl;
    if (patch.onboardingCompleted !== undefined) set.onboardingCompleted = patch.onboardingCompleted;
    if (Object.keys(set).length === 0) return db.select().from(users).where(eq(users.id, id)).get();
    return db.update(users).set(set).where(eq(users.id, id)).returning().get();
  }
  async createUser(u: { username?: string; password?: string; spotifyId?: string; googleId?: string; email?: string; displayName?: string; avatarUrl?: string }): Promise<User> {
    const username = u.username || u.email?.split("@")[0] || u.spotifyId || u.googleId || `user_${Date.now()}`;
    return db.insert(users).values({
      username,
      password: u.password ?? null,
      spotifyId: u.spotifyId ?? null,
      googleId: u.googleId ?? null,
      email: u.email ?? null,
      displayName: u.displayName ?? null,
      avatarUrl: u.avatarUrl ?? null,
      createdAt: Date.now(),
    }).returning().get();
  }

  async createSession(userId: number): Promise<{ id: string; expiresAt: number }> {
    const id = randomUUID();
    const expiresAt = Date.now() + 365 * 24 * 60 * 60 * 1000; // 1 year
    db.insert(sessions).values({ id, userId, expiresAt, createdAt: Date.now() }).run();
    return { id, expiresAt };
  }

  async getSessionUser(sessionId: string): Promise<User | null> {
    const session = db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
    if (!session) return null;
    if (session.expiresAt < Date.now()) {
      db.delete(sessions).where(eq(sessions.id, sessionId)).run();
      return null;
    }
    // Sliding expiry: if the session will expire in less than 6 months, extend it to 1 year
    const SIX_MONTHS = 183 * 24 * 60 * 60 * 1000;
    const ONE_YEAR = 365 * 24 * 60 * 60 * 1000;
    if (session.expiresAt - Date.now() < SIX_MONTHS) {
      const newExpiry = Date.now() + ONE_YEAR;
      db.update(sessions).set({ expiresAt: newExpiry }).where(eq(sessions.id, sessionId)).run();
    }
    const user = db.select().from(users).where(eq(users.id, session.userId)).get();
    return user ?? null;
  }

  async deleteSession(sessionId: string): Promise<void> {
    db.delete(sessions).where(eq(sessions.id, sessionId)).run();
  }

  // ── Ratings ──────────────────────────────────────────────────────────────
  async listRatings(userId: number, kind?: string): Promise<Rating[]> {
    if (kind) {
      return db.select().from(ratings).where(and(eq(ratings.userId, userId), eq(ratings.kind, kind))).orderBy(desc(ratings.createdAt)).all();
    }
    return db.select().from(ratings).where(eq(ratings.userId, userId)).orderBy(desc(ratings.createdAt)).all();
  }

  async upsertRating(userId: number, r: InsertRating): Promise<Rating> {
    db.delete(ratings).where(and(eq(ratings.userId, userId), eq(ratings.kind, r.kind), eq(ratings.externalId, r.externalId))).run();
    return db.insert(ratings).values({ ...r, userId, createdAt: Date.now() }).returning().get();
  }

  async removeRating(userId: number, kind: string, externalId: string): Promise<{ changes: number }> {
    return db.delete(ratings).where(and(eq(ratings.userId, userId), eq(ratings.kind, kind), eq(ratings.externalId, externalId))).run();
  }

  // ── Holdings ─────────────────────────────────────────────────────────────
  async listHoldings(userId: number, kind?: string): Promise<Holding[]> {
    if (kind) {
      return db.select().from(holdings).where(and(eq(holdings.userId, userId), eq(holdings.kind, kind))).orderBy(desc(holdings.createdAt)).all();
    }
    return db.select().from(holdings).where(eq(holdings.userId, userId)).orderBy(desc(holdings.createdAt)).all();
  }

  async addHolding(userId: number, h: InsertHolding): Promise<Holding> {
    return db.insert(holdings).values({ ...h, userId, createdAt: Date.now() }).returning().get();
  }

  async updateHolding(userId: number, id: number, patch: Partial<InsertHolding>): Promise<Holding | undefined> {
    db.update(holdings).set(patch).where(and(eq(holdings.id, id), eq(holdings.userId, userId))).run();
    return db.select().from(holdings).where(eq(holdings.id, id)).get();
  }

  async removeHolding(userId: number, id: number): Promise<{ changes: number }> {
    return db.delete(holdings).where(and(eq(holdings.id, id), eq(holdings.userId, userId))).run();
  }

  // ── Watchlist ─────────────────────────────────────────────────────────────
  async listWatchlist(userId: number, kind?: string): Promise<Watchlist[]> {
    if (kind) {
      return db.select().from(watchlist).where(and(eq(watchlist.userId, userId), eq(watchlist.kind, kind))).orderBy(desc(watchlist.createdAt)).all();
    }
    return db.select().from(watchlist).where(eq(watchlist.userId, userId)).orderBy(desc(watchlist.createdAt)).all();
  }

  async addWatchlist(userId: number, w: InsertWatchlist): Promise<Watchlist> {
    return db.insert(watchlist).values({ ...w, userId, createdAt: Date.now() }).returning().get();
  }

  async removeWatchlist(userId: number, id: number): Promise<{ changes: number }> {
    return db.delete(watchlist).where(and(eq(watchlist.id, id), eq(watchlist.userId, userId))).run();
  }

  // ── Subscriptions ─────────────────────────────────────────────────────────
  async listSubscriptions(userId: number): Promise<Subscription[]> {
    return db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).orderBy(desc(subscriptions.createdAt)).all();
  }
  async addSubscription(userId: number, s: InsertSubscription): Promise<Subscription> {
    return db.insert(subscriptions).values({ ...s, userId, createdAt: Date.now() }).returning().get();
  }
  async removeSubscription(userId: number, id: number): Promise<{ changes: number }> {
    return db.delete(subscriptions).where(and(eq(subscriptions.id, id), eq(subscriptions.userId, userId))).run();
  }

  // ── Food spots ────────────────────────────────────────────────────────────
  async listFoodSpots(userId: number, q?: { city?: string; query?: string; source?: string }): Promise<FoodSpot[]> {
    const all = db.select().from(foodSpots).where(eq(foodSpots.userId, userId)).orderBy(desc(foodSpots.createdAt)).all();
    let rows = all;
    if (q?.city) rows = rows.filter(r => r.city.toLowerCase().includes(q.city!.toLowerCase()));
    if (q?.source) rows = rows.filter(r => r.source === q.source);
    if (q?.query) {
      const needle = q.query.toLowerCase();
      rows = rows.filter(r =>
        r.name.toLowerCase().includes(needle) ||
        (r.category || '').toLowerCase().includes(needle) ||
        (r.note || '').toLowerCase().includes(needle)
      );
    }
    return rows;
  }
  async addFoodSpot(userId: number, f: InsertFoodSpot): Promise<FoodSpot> {
    return db.insert(foodSpots).values({ ...f, userId, createdAt: Date.now() }).returning().get();
  }
  async removeFoodSpot(userId: number, id: number): Promise<{ changes: number }> {
    return db.delete(foodSpots).where(and(eq(foodSpots.id, id), eq(foodSpots.userId, userId))).run();
  }

  // ── Rec feedback ──────────────────────────────────────────────────────────
  async listRecFeedback(userId: number, kind?: string): Promise<RecFeedback[]> {
    if (kind) {
      return db.select().from(recFeedback).where(and(eq(recFeedback.userId, userId), eq(recFeedback.kind, kind))).orderBy(desc(recFeedback.createdAt)).all();
    }
    return db.select().from(recFeedback).where(eq(recFeedback.userId, userId)).orderBy(desc(recFeedback.createdAt)).all();
  }
  async upsertRecFeedback(userId: number, f: InsertRecFeedback): Promise<RecFeedback> {
    db.delete(recFeedback).where(and(eq(recFeedback.userId, userId), eq(recFeedback.kind, f.kind), eq(recFeedback.externalId, f.externalId))).run();
    return db.insert(recFeedback).values({ ...f, userId, createdAt: Date.now() }).returning().get();
  }
  async removeRecFeedback(userId: number, kind: string, externalId: string): Promise<{ changes: number }> {
    return db.delete(recFeedback).where(and(eq(recFeedback.userId, userId), eq(recFeedback.kind, kind), eq(recFeedback.externalId, externalId))).run();
  }

  // ── User items ────────────────────────────────────────────────────────────
  async listUserItems(userId: number, kind?: string): Promise<UserItem[]> {
    if (kind) {
      return db.select().from(userItems).where(and(eq(userItems.userId, userId), eq(userItems.kind, kind))).orderBy(desc(userItems.createdAt)).all();
    }
    return db.select().from(userItems).where(eq(userItems.userId, userId)).orderBy(desc(userItems.createdAt)).all();
  }
  async addUserItem(userId: number, u: InsertUserItem): Promise<UserItem> {
    return db.insert(userItems).values({ ...u, userId, createdAt: Date.now() }).returning().get();
  }
  async removeUserItem(userId: number, id: number): Promise<{ changes: number }> {
    return db.delete(userItems).where(and(eq(userItems.id, id), eq(userItems.userId, userId))).run();
  }

  // ── Secrets ───────────────────────────────────────────────────────────────
  async getSecret(userId: number, key: string): Promise<string | undefined> {
    const row = db.select().from(secrets).where(and(eq(secrets.userId, userId), eq(secrets.key, key))).get();
    return row?.value;
  }
  async setSecret(userId: number, key: string, value: string): Promise<void> {
    db.delete(secrets).where(and(eq(secrets.userId, userId), eq(secrets.key, key))).run();
    db.insert(secrets).values({ userId, key, value, updatedAt: Date.now() }).run();
  }

  // ── Plaid items ───────────────────────────────────────────────────────────
  async savePlaidItem(userId: number, item: { itemId: string; accessToken: string; institutionName?: string }): Promise<PlaidItem> {
    return db.insert(plaidItems).values({
      userId,
      itemId: item.itemId,
      accessToken: item.accessToken,
      institutionName: item.institutionName ?? null,
      createdAt: Date.now(),
    }).returning().get();
  }
  async getPlaidItems(userId: number): Promise<PlaidItem[]> {
    return db.select().from(plaidItems).where(eq(plaidItems.userId, userId)).orderBy(desc(plaidItems.createdAt)).all();
  }
  async deletePlaidItem(userId: number, itemId: string): Promise<{ changes: number }> {
    return db.delete(plaidItems).where(and(eq(plaidItems.userId, userId), eq(plaidItems.itemId, itemId))).run();
  }

  async getAtlasLink(userId: number): Promise<AtlasLink | undefined> {
    return db.select().from(atlasLinks).where(eq(atlasLinks.userId, userId)).get();
  }
  async upsertAtlasLink(userId: number, atlasUserId: string, atlasUsername: string | null, atlasName: string | null): Promise<AtlasLink> {
    const existing = await this.getAtlasLink(userId);
    if (existing) {
      return db.update(atlasLinks).set({ atlasUserId, atlasUsername, atlasName, connectedAt: Date.now() }).where(eq(atlasLinks.userId, userId)).returning().get();
    }
    return db.insert(atlasLinks).values({ userId, atlasUserId, atlasUsername, atlasName, connectedAt: Date.now() }).returning().get();
  }
  async deleteAtlasLink(userId: number): Promise<{ changes: number }> {
    return db.delete(atlasLinks).where(eq(atlasLinks.userId, userId)).run();
  }

  // ── Households ────────────────────────────────────────────────────────────
  async getHouseholdForUser(userId: number): Promise<{ id: number; name: string | null; createdBy: number; createdAt: number } | undefined> {
    const member = sqlite.prepare("SELECT household_id FROM household_members WHERE user_id = ?").get(userId) as any;
    if (!member) return undefined;
    const row = sqlite.prepare("SELECT * FROM households WHERE id = ?").get(member.household_id) as any;
    if (!row) return undefined;
    return { id: row.id, name: row.name, createdBy: row.created_by, createdAt: row.created_at };
  }

  async getHouseholdMemberIds(householdId: number): Promise<number[]> {
    const rows = sqlite.prepare("SELECT user_id FROM household_members WHERE household_id = ?").all(householdId) as any[];
    return rows.map(r => r.user_id);
  }

  async createHousehold(userId: number, name?: string): Promise<{ id: number; name: string | null; createdBy: number; createdAt: number }> {
    const now = Date.now();
    const result = sqlite.prepare(
      "INSERT INTO households (name, created_by, created_at) VALUES (?, ?, ?)"
    ).run(name ?? null, userId, now);
    const householdId = Number(result.lastInsertRowid);
    sqlite.prepare(
      "INSERT INTO household_members (household_id, user_id, joined_at) VALUES (?, ?, ?)"
    ).run(householdId, userId, now);
    return { id: householdId, name: name ?? null, createdBy: userId, createdAt: now };
  }

  async addHouseholdMember(householdId: number, userId: number): Promise<void> {
    sqlite.prepare(
      "INSERT INTO household_members (household_id, user_id, joined_at) VALUES (?, ?, ?)"
    ).run(householdId, userId, Date.now());
  }

  async removeHouseholdMember(userId: number): Promise<{ changes: number }> {
    const result = sqlite.prepare("DELETE FROM household_members WHERE user_id = ?").run(userId);
    return { changes: result.changes };
  }

  async createHouseholdInvite(householdId: number, createdBy: number, code: string, ttlMs: number): Promise<{ householdId: number; code: string; createdBy: number; createdAt: number; expiresAt: number }> {
    const now = Date.now();
    const expiresAt = now + ttlMs;
    sqlite.prepare(`
      INSERT INTO household_invites (household_id, code, created_by, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(householdId, code, createdBy, now, expiresAt);
    return { householdId, code, createdBy, createdAt: now, expiresAt };
  }

  async getActiveInviteForHousehold(householdId: number): Promise<any> {
    return sqlite.prepare(`
      SELECT * FROM household_invites
      WHERE household_id = ? AND used_at IS NULL AND expires_at > ?
      ORDER BY created_at DESC LIMIT 1
    `).get(householdId, Date.now());
  }

  async getInviteByCode(code: string): Promise<any> {
    return sqlite.prepare("SELECT * FROM household_invites WHERE code = ?").get(code);
  }

  async markInviteUsed(code: string, usedBy: number): Promise<void> {
    sqlite.prepare("UPDATE household_invites SET used_at = ?, used_by = ? WHERE code = ?").run(Date.now(), usedBy, code);
  }

  // ── Account visibility (household-scoped Finance sharing) ─────────────────
  async getAccountVisibility(householdId: number, ownerUserId: number): Promise<Array<{ accountType: string; accountRef: string; visible: boolean }>> {
    const rows = sqlite.prepare(
      "SELECT account_type, account_ref, visible FROM account_visibility WHERE household_id = ? AND user_id = ?"
    ).all(householdId, ownerUserId) as any[];
    return rows.map(r => ({ accountType: r.account_type, accountRef: r.account_ref, visible: !!r.visible }));
  }

  async setAccountVisibility(householdId: number, ownerUserId: number, accountType: string, accountRef: string, visible: boolean): Promise<void> {
    const now = Date.now();
    sqlite.prepare(`
      INSERT INTO account_visibility (household_id, user_id, account_type, account_ref, visible, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(household_id, user_id, account_type, account_ref)
      DO UPDATE SET visible = excluded.visible, updated_at = excluded.updated_at
    `).run(householdId, ownerUserId, accountType, accountRef, visible ? 1 : 0, now);
  }

  // ── Domain-level sharing (Music, Events — opt-out, default shared) ────────
  async getDomainShareSettings(householdId: number, userId: number): Promise<Record<string, boolean>> {
    const rows = sqlite.prepare(
      "SELECT domain, shared FROM household_domain_shares WHERE household_id = ? AND user_id = ?"
    ).all(householdId, userId) as any[];
    const map: Record<string, boolean> = {};
    for (const r of rows) map[r.domain] = !!r.shared;
    return map;
  }

  async setDomainShared(householdId: number, userId: number, domain: string, shared: boolean): Promise<void> {
    const now = Date.now();
    sqlite.prepare(`
      INSERT INTO household_domain_shares (household_id, user_id, domain, shared, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(household_id, user_id, domain)
      DO UPDATE SET shared = excluded.shared, updated_at = excluded.updated_at
    `).run(householdId, userId, domain, shared ? 1 : 0, now);
  }

  // ── Cash / savings accounts (manual, no ticker) ────────────────────────────
  async listCashAccounts(userId: number): Promise<any[]> {
    const rows = sqlite.prepare(
      "SELECT * FROM cash_accounts WHERE user_id = ? ORDER BY created_at DESC"
    ).all(userId) as any[];
    return rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      name: r.name,
      institution: r.institution,
      balance: r.balance,
      includeInPortfolio: !!r.include_in_portfolio,
      notes: r.notes,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async addCashAccount(userId: number, acc: { name: string; institution?: string | null; balance: number; includeInPortfolio?: boolean; notes?: string | null }): Promise<any> {
    const now = Date.now();
    const result = sqlite.prepare(`
      INSERT INTO cash_accounts (user_id, name, institution, balance, include_in_portfolio, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, acc.name, acc.institution ?? null, acc.balance, acc.includeInPortfolio === false ? 0 : 1, acc.notes ?? null, now, now);
    return {
      id: Number(result.lastInsertRowid),
      userId,
      name: acc.name,
      institution: acc.institution ?? null,
      balance: acc.balance,
      includeInPortfolio: acc.includeInPortfolio !== false,
      notes: acc.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }

  async updateCashAccount(userId: number, id: number, patch: { name?: string; institution?: string | null; balance?: number; includeInPortfolio?: boolean; notes?: string | null }): Promise<any> {
    const now = Date.now();
    const existing: any = sqlite.prepare("SELECT * FROM cash_accounts WHERE id = ? AND user_id = ?").get(id, userId);
    if (!existing) return undefined;
    const name = patch.name ?? existing.name;
    const institution = patch.institution !== undefined ? patch.institution : existing.institution;
    const balance = patch.balance !== undefined ? patch.balance : existing.balance;
    const includeInPortfolio = patch.includeInPortfolio !== undefined ? (patch.includeInPortfolio ? 1 : 0) : existing.include_in_portfolio;
    const notes = patch.notes !== undefined ? patch.notes : existing.notes;
    sqlite.prepare(`
      UPDATE cash_accounts SET name=?, institution=?, balance=?, include_in_portfolio=?, notes=?, updated_at=?
      WHERE id=? AND user_id=?
    `).run(name, institution, balance, includeInPortfolio, notes, now, id, userId);
    return {
      id, userId, name, institution, balance,
      includeInPortfolio: !!includeInPortfolio, notes,
      createdAt: existing.created_at, updatedAt: now,
    };
  }

  async removeCashAccount(userId: number, id: number): Promise<{ changes: number }> {
    const result = sqlite.prepare("DELETE FROM cash_accounts WHERE id = ? AND user_id = ?").run(id, userId);
    return { changes: result.changes };
  }

  // ── Visited places (native Path/Experience replacement) ────────────────────
  async listVisitedPlaces(userId: number): Promise<any[]> {
    const rows = sqlite.prepare(
      "SELECT * FROM visited_places WHERE user_id = ? ORDER BY created_at DESC"
    ).all(userId) as any[];
    return rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      type: r.type,
      name: r.name,
      location: r.location,
      latitude: r.latitude,
      longitude: r.longitude,
      visitedDate: r.visited_date,
      note: r.note,
      createdAt: r.created_at,
    }));
  }

  async addVisitedPlace(userId: number, p: {
    type: string; name: string; location?: string | null;
    latitude?: number | null; longitude?: number | null;
    visitedDate?: string | null; note?: string | null;
  }): Promise<any> {
    const now = Date.now();
    const result = sqlite.prepare(`
      INSERT INTO visited_places (user_id, type, name, location, latitude, longitude, visited_date, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, p.type, p.name, p.location ?? null, p.latitude ?? null, p.longitude ?? null, p.visitedDate ?? null, p.note ?? null, now);
    return {
      id: Number(result.lastInsertRowid), userId, type: p.type, name: p.name,
      location: p.location ?? null, latitude: p.latitude ?? null, longitude: p.longitude ?? null,
      visitedDate: p.visitedDate ?? null, note: p.note ?? null, createdAt: now,
    };
  }

  async updateVisitedPlace(userId: number, id: number, patch: {
    type?: string; name?: string; location?: string | null;
    latitude?: number | null; longitude?: number | null;
    visitedDate?: string | null; note?: string | null;
  }): Promise<any> {
    const existing: any = sqlite.prepare("SELECT * FROM visited_places WHERE id = ? AND user_id = ?").get(id, userId);
    if (!existing) return undefined;
    const type = patch.type ?? existing.type;
    const name = patch.name ?? existing.name;
    const location = patch.location !== undefined ? patch.location : existing.location;
    const latitude = patch.latitude !== undefined ? patch.latitude : existing.latitude;
    const longitude = patch.longitude !== undefined ? patch.longitude : existing.longitude;
    const visitedDate = patch.visitedDate !== undefined ? patch.visitedDate : existing.visited_date;
    const note = patch.note !== undefined ? patch.note : existing.note;
    sqlite.prepare(`
      UPDATE visited_places SET type=?, name=?, location=?, latitude=?, longitude=?, visited_date=?, note=?
      WHERE id=? AND user_id=?
    `).run(type, name, location, latitude, longitude, visitedDate, note, id, userId);
    return { id, userId, type, name, location, latitude, longitude, visitedDate, note, createdAt: existing.created_at };
  }

  async removeVisitedPlace(userId: number, id: number): Promise<{ changes: number }> {
    const result = sqlite.prepare("DELETE FROM visited_places WHERE id = ? AND user_id = ?").run(id, userId);
    return { changes: result.changes };
  }
}

export const storage = new DatabaseStorage();
