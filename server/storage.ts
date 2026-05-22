import { users, ratings, holdings, watchlist, subscriptions, foodSpots, recFeedback, userItems, secrets } from '@shared/schema';
import type {
  User, InsertUser,
  Rating, InsertRating,
  Holding, InsertHolding,
  Watchlist, InsertWatchlist,
  Subscription, InsertSubscription,
  FoodSpot, InsertFoodSpot,
  RecFeedback, InsertRecFeedback,
  UserItem, InsertUserItem,
} from '@shared/schema';
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, and, desc } from "drizzle-orm";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

// Run lightweight migration on boot — the template doesn't run drizzle migrations automatically.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    external_id TEXT NOT NULL,
    title TEXT NOT NULL,
    signal INTEGER NOT NULL,
    meta TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ratings_kind_external ON ratings(kind, external_id);
  CREATE TABLE IF NOT EXISTS holdings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    symbol TEXT NOT NULL,
    name TEXT,
    quantity REAL NOT NULL,
    cost_basis REAL NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_holdings_kind ON holdings(kind);
  CREATE TABLE IF NOT EXISTS watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    symbol TEXT NOT NULL,
    name TEXT,
    note TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_watchlist_kind ON watchlist(kind);
  CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    amount REAL NOT NULL,
    cadence TEXT NOT NULL,
    category TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    next_charge TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_subscriptions_source ON subscriptions(source);
  CREATE TABLE IF NOT EXISTS food_spots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  CREATE TABLE IF NOT EXISTS rec_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    external_id TEXT NOT NULL,
    signal INTEGER NOT NULL,
    reason TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_rec_feedback_kind_ext ON rec_feedback(kind, external_id);
  CREATE TABLE IF NOT EXISTS user_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    subtitle TEXT,
    url TEXT,
    meta TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_user_items_kind ON user_items(kind);
  CREATE TABLE IF NOT EXISTS secrets (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

export const db = drizzle(sqlite);

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  listRatings(kind?: string): Promise<Rating[]>;
  upsertRating(r: InsertRating): Promise<Rating>;
  removeRating(kind: string, externalId: string): Promise<{ changes: number }>;

  listHoldings(kind?: string): Promise<Holding[]>;
  addHolding(h: InsertHolding): Promise<Holding>;
  updateHolding(id: number, patch: Partial<InsertHolding>): Promise<Holding | undefined>;
  removeHolding(id: number): Promise<{ changes: number }>;

  listWatchlist(kind?: string): Promise<Watchlist[]>;
  addWatchlist(w: InsertWatchlist): Promise<Watchlist>;
  removeWatchlist(id: number): Promise<{ changes: number }>;

  listSubscriptions(): Promise<Subscription[]>;
  addSubscription(s: InsertSubscription): Promise<Subscription>;
  removeSubscription(id: number): Promise<{ changes: number }>;

  listFoodSpots(q?: { city?: string; query?: string; source?: string }): Promise<FoodSpot[]>;
  addFoodSpot(f: InsertFoodSpot): Promise<FoodSpot>;
  removeFoodSpot(id: number): Promise<{ changes: number }>;

  listRecFeedback(kind?: string): Promise<RecFeedback[]>;
  upsertRecFeedback(f: InsertRecFeedback): Promise<RecFeedback>;
  removeRecFeedback(kind: string, externalId: string): Promise<{ changes: number }>;

  listUserItems(kind?: string): Promise<UserItem[]>;
  addUserItem(u: InsertUserItem): Promise<UserItem>;
  removeUserItem(id: number): Promise<{ changes: number }>;

  getSecret(key: string): Promise<string | undefined>;
  setSecret(key: string, value: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.id, id)).get();
  }
  async getUserByUsername(username: string): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.username, username)).get();
  }
  async createUser(insertUser: InsertUser): Promise<User> {
    return db.insert(users).values(insertUser).returning().get();
  }

  async listRatings(kind?: string): Promise<Rating[]> {
    if (kind) {
      return db.select().from(ratings).where(eq(ratings.kind, kind)).orderBy(desc(ratings.createdAt)).all();
    }
    return db.select().from(ratings).orderBy(desc(ratings.createdAt)).all();
  }

  async upsertRating(r: InsertRating): Promise<Rating> {
    // delete-then-insert idiom for upsert (drizzle-sqlite's onConflict is fiddly without an explicit unique constraint)
    db.delete(ratings).where(and(eq(ratings.kind, r.kind), eq(ratings.externalId, r.externalId))).run();
    return db.insert(ratings).values({ ...r, createdAt: Date.now() }).returning().get();
  }

  async removeRating(kind: string, externalId: string): Promise<{ changes: number }> {
    return db.delete(ratings).where(and(eq(ratings.kind, kind), eq(ratings.externalId, externalId))).run();
  }

  async listHoldings(kind?: string): Promise<Holding[]> {
    if (kind) {
      return db.select().from(holdings).where(eq(holdings.kind, kind)).orderBy(desc(holdings.createdAt)).all();
    }
    return db.select().from(holdings).orderBy(desc(holdings.createdAt)).all();
  }

  async addHolding(h: InsertHolding): Promise<Holding> {
    return db.insert(holdings).values({ ...h, createdAt: Date.now() }).returning().get();
  }

  async updateHolding(id: number, patch: Partial<InsertHolding>): Promise<Holding | undefined> {
    db.update(holdings).set(patch).where(eq(holdings.id, id)).run();
    return db.select().from(holdings).where(eq(holdings.id, id)).get();
  }

  async removeHolding(id: number): Promise<{ changes: number }> {
    return db.delete(holdings).where(eq(holdings.id, id)).run();
  }

  async listWatchlist(kind?: string): Promise<Watchlist[]> {
    if (kind) {
      return db.select().from(watchlist).where(eq(watchlist.kind, kind)).orderBy(desc(watchlist.createdAt)).all();
    }
    return db.select().from(watchlist).orderBy(desc(watchlist.createdAt)).all();
  }

  async addWatchlist(w: InsertWatchlist): Promise<Watchlist> {
    return db.insert(watchlist).values({ ...w, createdAt: Date.now() }).returning().get();
  }

  async removeWatchlist(id: number): Promise<{ changes: number }> {
    return db.delete(watchlist).where(eq(watchlist.id, id)).run();
  }

  async listSubscriptions(): Promise<Subscription[]> {
    return db.select().from(subscriptions).orderBy(desc(subscriptions.createdAt)).all();
  }
  async addSubscription(s: InsertSubscription): Promise<Subscription> {
    return db.insert(subscriptions).values({ ...s, createdAt: Date.now() }).returning().get();
  }
  async removeSubscription(id: number): Promise<{ changes: number }> {
    return db.delete(subscriptions).where(eq(subscriptions.id, id)).run();
  }

  async listFoodSpots(q?: { city?: string; query?: string; source?: string }): Promise<FoodSpot[]> {
    const all = db.select().from(foodSpots).orderBy(desc(foodSpots.createdAt)).all();
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
  async addFoodSpot(f: InsertFoodSpot): Promise<FoodSpot> {
    return db.insert(foodSpots).values({ ...f, createdAt: Date.now() }).returning().get();
  }
  async removeFoodSpot(id: number): Promise<{ changes: number }> {
    return db.delete(foodSpots).where(eq(foodSpots.id, id)).run();
  }

  async listRecFeedback(kind?: string): Promise<RecFeedback[]> {
    if (kind) {
      return db.select().from(recFeedback).where(eq(recFeedback.kind, kind)).orderBy(desc(recFeedback.createdAt)).all();
    }
    return db.select().from(recFeedback).orderBy(desc(recFeedback.createdAt)).all();
  }
  async upsertRecFeedback(f: InsertRecFeedback): Promise<RecFeedback> {
    db.delete(recFeedback).where(and(eq(recFeedback.kind, f.kind), eq(recFeedback.externalId, f.externalId))).run();
    return db.insert(recFeedback).values({ ...f, createdAt: Date.now() }).returning().get();
  }
  async removeRecFeedback(kind: string, externalId: string): Promise<{ changes: number }> {
    return db.delete(recFeedback).where(and(eq(recFeedback.kind, kind), eq(recFeedback.externalId, externalId))).run();
  }

  async listUserItems(kind?: string): Promise<UserItem[]> {
    if (kind) {
      return db.select().from(userItems).where(eq(userItems.kind, kind)).orderBy(desc(userItems.createdAt)).all();
    }
    return db.select().from(userItems).orderBy(desc(userItems.createdAt)).all();
  }
  async addUserItem(u: InsertUserItem): Promise<UserItem> {
    return db.insert(userItems).values({ ...u, createdAt: Date.now() }).returning().get();
  }
  async removeUserItem(id: number): Promise<{ changes: number }> {
    return db.delete(userItems).where(eq(userItems.id, id)).run();
  }

  async getSecret(key: string): Promise<string | undefined> {
    const row = db.select().from(secrets).where(eq(secrets.key, key)).get();
    return row?.value;
  }
  async setSecret(key: string, value: string): Promise<void> {
    db.delete(secrets).where(eq(secrets.key, key)).run();
    db.insert(secrets).values({ key, value, updatedAt: Date.now() }).run();
  }
}

export const storage = new DatabaseStorage();
