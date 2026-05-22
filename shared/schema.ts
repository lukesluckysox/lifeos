import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  password: text("password"), // nullable for OAuth-only users
  spotifyId: text("spotify_id").unique(),
  googleId: text("google_id").unique(),
  email: text("email"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  createdAt: integer("created_at").notNull(),
  onboardingCompleted: integer("onboarding_completed").default(0),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
}).partial({ password: true });

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

/**
 * Sessions — HTTP-only cookie session IDs mapped to users.
 */
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(), // random UUID
  userId: integer("user_id").notNull().references(() => users.id),
  expiresAt: integer("expires_at").notNull(), // ms epoch
  createdAt: integer("created_at").notNull(),
});

export type Session = typeof sessions.$inferSelect;

/**
 * Ratings — user's like / dislike / watchlist signal across all domains.
 */
export const ratings = sqliteTable("ratings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  kind: text("kind").notNull(),
  externalId: text("external_id").notNull(),
  title: text("title").notNull(),
  signal: integer("signal").notNull(),
  meta: text("meta"),
  createdAt: integer("created_at").notNull(),
});

export const insertRatingSchema = createInsertSchema(ratings).omit({
  id: true,
  createdAt: true,
  userId: true,
});

export type Rating = typeof ratings.$inferSelect;
export type InsertRating = z.infer<typeof insertRatingSchema>;

/**
 * Holdings — manually entered or imported positions.
 */
export const holdings = sqliteTable("holdings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
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
  userId: true,
});

export type Holding = typeof holdings.$inferSelect;
export type InsertHolding = z.infer<typeof insertHoldingSchema>;

/**
 * Watchlist — symbols the user is tracking but doesn't own.
 */
export const watchlist = sqliteTable("watchlist", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  kind: text("kind").notNull(),
  symbol: text("symbol").notNull(),
  name: text("name"),
  note: text("note"),
  createdAt: integer("created_at").notNull(),
});

export const insertWatchlistSchema = createInsertSchema(watchlist).omit({
  id: true,
  createdAt: true,
  userId: true,
});

export type Watchlist = typeof watchlist.$inferSelect;
export type InsertWatchlist = z.infer<typeof insertWatchlistSchema>;

/**
 * Subscriptions — manually-tracked or auto-detected recurring charges.
 */
export const subscriptions = sqliteTable("subscriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  amount: real("amount").notNull(),
  cadence: text("cadence").notNull(),
  category: text("category"),
  source: text("source").notNull().default("manual"),
  nextCharge: text("next_charge"),
  createdAt: integer("created_at").notNull(),
});
export const insertSubscriptionSchema = createInsertSchema(subscriptions).omit({ id: true, createdAt: true, userId: true });
export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;

/**
 * Food spots — user-saved restaurants / cafes / bars.
 */
export const foodSpots = sqliteTable("food_spots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  city: text("city").notNull(),
  category: text("category"),
  note: text("note"),
  url: text("url"),
  source: text("source").notNull().default("manual"),
  createdAt: integer("created_at").notNull(),
});
export const insertFoodSpotSchema = createInsertSchema(foodSpots).omit({ id: true, createdAt: true, userId: true });
export type FoodSpot = typeof foodSpots.$inferSelect;
export type InsertFoodSpot = z.infer<typeof insertFoodSpotSchema>;

/**
 * Rec feedback — 👍 / 👎 on recommendation cards.
 */
export const recFeedback = sqliteTable("rec_feedback", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  kind: text("kind").notNull(),
  externalId: text("external_id").notNull(),
  signal: integer("signal").notNull(),
  reason: text("reason"),
  createdAt: integer("created_at").notNull(),
});
export const insertRecFeedbackSchema = createInsertSchema(recFeedback).omit({ id: true, createdAt: true, userId: true });
export type RecFeedback = typeof recFeedback.$inferSelect;
export type InsertRecFeedback = z.infer<typeof insertRecFeedbackSchema>;

/**
 * User items — generic "add your own" across domains.
 */
export const userItems = sqliteTable("user_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  url: text("url"),
  meta: text("meta"),
  createdAt: integer("created_at").notNull(),
});
export const insertUserItemSchema = createInsertSchema(userItems).omit({ id: true, createdAt: true, userId: true });
export type UserItem = typeof userItems.$inferSelect;
export type InsertUserItem = z.infer<typeof insertUserItemSchema>;

/**
 * Secrets — small key/value store for per-user credentials.
 * PK is composite (userId, key).
 */
export const secrets = sqliteTable("secrets", {
  userId: integer("user_id").notNull(),
  key: text("key").notNull(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/**
 * Plaid items — connected brokerage/bank accounts via Plaid.
 */
export const plaidItems = sqliteTable("plaid_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  itemId: text("item_id").notNull(),
  accessToken: text("access_token").notNull(),
  institutionName: text("institution_name"),
  createdAt: integer("created_at").notNull(),
});

export const insertPlaidItemSchema = createInsertSchema(plaidItems).omit({ id: true, createdAt: true, userId: true });
export type PlaidItem = typeof plaidItems.$inferSelect;
export type InsertPlaidItem = z.infer<typeof insertPlaidItemSchema>;
