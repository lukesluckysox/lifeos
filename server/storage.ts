import { users, sessions, ratings, holdings, watchlist, subscriptions, foodSpots, recFeedback, userItems, secrets, plaidItems } from '@shared/schema';
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
} from '@shared/schema';
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { eq, and, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";

// Resolve DB path:
//  - Production (Railway): point DB_PATH at a persistent volume
//    (e.g. DB_PATH=/data/data.db with a volume mounted at /data).
//    Without this, EVERY redeploy wipes data.db — sessions, manual
//    holdings, Plaid item references, watchlist, all gone.
//  - Local dev: defaults to ./data.db in the working directory.
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
// Index can't be on UNIQUE retroactively in SQLite without rebuilding
// the table, but a partial unique index gives us uniqueness for non-null
// google_id values, which is what we actually need.
try {
  sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL");
} catch {}

export const db = drizzle(sqlite);

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserBySpotifyId(spotifyId: string): Promise<User | undefined>;
  getUserByGoogleId(googleId: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  updateUser(id: number, patch: { googleId?: string; spotifyId?: string; displayName?: string; avatarUrl?: string }): Promise<User | undefined>;
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
}

export class DatabaseStorage implements IStorage {
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
  async updateUser(id: number, patch: { googleId?: string; spotifyId?: string; displayName?: string; avatarUrl?: string }): Promise<User | undefined> {
    const set: Record<string, any> = {};
    if (patch.googleId !== undefined) set.googleId = patch.googleId;
    if (patch.spotifyId !== undefined) set.spotifyId = patch.spotifyId;
    if (patch.displayName !== undefined) set.displayName = patch.displayName;
    if (patch.avatarUrl !== undefined) set.avatarUrl = patch.avatarUrl;
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
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
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
}

export const storage = new DatabaseStorage();
