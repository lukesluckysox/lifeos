import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

/**
 * Ratings — user's like / dislike / watchlist signal across all domains.
 * Used to push and filter recommendations.
 *
 *   kind: 'show' | 'film' | 'artist' | 'place' | 'event'
 *   external_id: stable id from the source (e.g. TMDB id, Ticketmaster id, Spotify id, internal seed id)
 *   signal: -1 dislike, 0 watchlist/save, 1 like, 2 love
 */
export const ratings = sqliteTable("ratings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(),
  externalId: text("external_id").notNull(),
  title: text("title").notNull(),
  signal: integer("signal").notNull(),
  meta: text("meta"), // JSON blob: poster, year, genre, etc.
  createdAt: integer("created_at").notNull(),
});

export const insertRatingSchema = createInsertSchema(ratings).omit({
  id: true,
  createdAt: true,
});

export type Rating = typeof ratings.$inferSelect;
export type InsertRating = z.infer<typeof insertRatingSchema>;

/**
 * Holdings — manually entered or imported positions.
 * Used when no brokerage is connected, or to track crypto separately.
 *
 *   kind: 'stock' | 'crypto'
 *   symbol: ticker for stocks (NVDA), coin symbol for crypto (BTC, ETH, SOL)
 *   quantity: shares or coins held
 *   costBasis: average price per share/coin paid (USD)
 */
export const holdings = sqliteTable("holdings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(),
  symbol: text("symbol").notNull(),
  name: text("name"),
  quantity: real("quantity").notNull(),
  costBasis: real("cost_basis").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const insertHoldingSchema = createInsertSchema(holdings).omit({
  id: true,
  createdAt: true,
});

export type Holding = typeof holdings.$inferSelect;
export type InsertHolding = z.infer<typeof insertHoldingSchema>;

/**
 * Watchlist — symbols the user is tracking but doesn't own.
 *   kind: 'stock' | 'crypto'
 *   symbol: NVDA, BTC, etc.
 *   note: optional reason for adding ("watching for dip", "earnings 5/22")
 */
export const watchlist = sqliteTable("watchlist", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(),
  symbol: text("symbol").notNull(),
  name: text("name"),
  note: text("note"),
  createdAt: integer("created_at").notNull(),
});

export const insertWatchlistSchema = createInsertSchema(watchlist).omit({
  id: true,
  createdAt: true,
});

export type Watchlist = typeof watchlist.$inferSelect;
export type InsertWatchlist = z.infer<typeof insertWatchlistSchema>;

/**
 * Subscriptions — manually-tracked or auto-detected recurring charges.
 *   cadence: 'monthly' | 'yearly' | 'weekly'
 *   source: 'manual' | 'detected'
 */
export const subscriptions = sqliteTable("subscriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  amount: real("amount").notNull(),
  cadence: text("cadence").notNull(),
  category: text("category"),
  source: text("source").notNull().default("manual"),
  nextCharge: text("next_charge"),
  createdAt: integer("created_at").notNull(),
});
export const insertSubscriptionSchema = createInsertSchema(subscriptions).omit({ id: true, createdAt: true });
export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;

/**
 * Food spots — user-saved restaurants / cafes / bars.
 *   source: 'curated' | 'osm' | 'manual'
 */
export const foodSpots = sqliteTable("food_spots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  city: text("city").notNull(),
  category: text("category"),
  note: text("note"),
  url: text("url"),
  source: text("source").notNull().default("manual"),
  createdAt: integer("created_at").notNull(),
});
export const insertFoodSpotSchema = createInsertSchema(foodSpots).omit({ id: true, createdAt: true });
export type FoodSpot = typeof foodSpots.$inferSelect;
export type InsertFoodSpot = z.infer<typeof insertFoodSpotSchema>;

/**
 * Rec feedback — 👍 / 👎 on recommendation cards across domains.
 *   kind: 'music' | 'finance' | 'concert' | 'food' | 'film' | 'show'
 *   externalId: stable id of the rec target (ticker, track id, venue id, etc.)
 *   signal: 1 (up) or -1 (down)
 */
export const recFeedback = sqliteTable("rec_feedback", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(),
  externalId: text("external_id").notNull(),
  signal: integer("signal").notNull(),
  reason: text("reason"),
  createdAt: integer("created_at").notNull(),
});
export const insertRecFeedbackSchema = createInsertSchema(recFeedback).omit({ id: true, createdAt: true });
export type RecFeedback = typeof recFeedback.$inferSelect;
export type InsertRecFeedback = z.infer<typeof insertRecFeedbackSchema>;

/**
 * User items — generic "add your own" across domains where the seeded feed comes from a connector
 * but the user wants to pin their own.
 *   kind: 'music' | 'concert' | 'place' | 'food' | 'film' | 'show' | 'artist'
 *   title: the headline (track name, venue, place, etc.)
 *   subtitle: optional second line (artist, city, year)
 *   url: optional external link
 *   meta: optional JSON blob
 */
export const userItems = sqliteTable("user_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  url: text("url"),
  meta: text("meta"),
  createdAt: integer("created_at").notNull(),
});
export const insertUserItemSchema = createInsertSchema(userItems).omit({ id: true, createdAt: true });
export type UserItem = typeof userItems.$inferSelect;
export type InsertUserItem = z.infer<typeof insertUserItemSchema>;

/**
 * Secrets — small key/value store for per-user credentials (Spotify refresh token, etc).
 * Single-user app: no auth, key is unique.
 */
export const secrets = sqliteTable("secrets", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
