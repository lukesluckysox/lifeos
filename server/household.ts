import { randomBytes } from "node:crypto";
import { storage } from "./storage";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function generateInviteCode(): string {
  // ~8 URL-safe chars, unique enough for a household invite (7 day TTL,
  // single use, and getInviteByCode enforces a unique index via the
  // household_invites.code UNIQUE constraint anyway).
  return randomBytes(6).toString("base64url").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8);
}

export interface HouseholdMember {
  id: number;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface HouseholdView {
  id: number;
  name: string | null;
  members: HouseholdMember[];
}

export async function getHouseholdView(userId: number): Promise<HouseholdView | null> {
  const household = await storage.getHouseholdForUser(userId);
  if (!household) return null;
  const memberIds = await storage.getHouseholdMemberIds(household.id);
  const members: HouseholdMember[] = [];
  for (const id of memberIds) {
    const u = await storage.getUser(id);
    if (u) members.push({ id: u.id, displayName: u.displayName, avatarUrl: u.avatarUrl });
  }
  return { id: household.id, name: household.name, members };
}

/**
 * Creates a household for the user if they don't have one yet, then
 * returns a shareable invite link. Reuses an existing unexpired, unused
 * invite instead of minting a new one every time Settings re-renders.
 */
export async function createOrReuseInvite(userId: number, publicUrl: string): Promise<{ code: string; url: string; expiresAt: number }> {
  let household = await storage.getHouseholdForUser(userId);
  if (!household) {
    household = await storage.createHousehold(userId);
  }
  const existing = await storage.getActiveInviteForHousehold(household.id);
  const invite = existing ?? await storage.createHouseholdInvite(household.id, userId, generateInviteCode(), INVITE_TTL_MS);
  const code = existing ? existing.code : invite.code;
  const expiresAt = existing ? existing.expires_at : invite.expiresAt;
  return {
    code,
    url: `${publicUrl.replace(/\/$/, "")}/#/join-household/${code}`,
    expiresAt,
  };
}

export interface JoinResult {
  ok: boolean;
  error?: string;
  household?: HouseholdView;
}

/** Validates an invite code and adds the joining user to that household. */
export async function joinHouseholdByCode(joiningUserId: number, code: string): Promise<JoinResult> {
  const invite = await storage.getInviteByCode(code);
  if (!invite) return { ok: false, error: "Invite not found." };
  if (invite.used_at) return { ok: false, error: "This invite has already been used." };
  if (invite.expires_at < Date.now()) return { ok: false, error: "This invite has expired." };
  if (invite.created_by === joiningUserId) return { ok: false, error: "You can't accept your own invite." };

  const alreadyIn = await storage.getHouseholdForUser(joiningUserId);
  if (alreadyIn) {
    if (alreadyIn.id === invite.household_id) {
      return { ok: true, household: (await getHouseholdView(joiningUserId)) ?? undefined };
    }
    return { ok: false, error: "You're already in a household. Leave it first to join a different one." };
  }

  await storage.addHouseholdMember(invite.household_id, joiningUserId);
  await storage.markInviteUsed(code, joiningUserId);
  const household = await getHouseholdView(joiningUserId);
  return { ok: true, household: household ?? undefined };
}

/**
 * Preview an invite (household name + inviter) without accepting it —
 * used to render the "X wants to share Life OS with you" confirm screen.
 */
export async function previewInvite(code: string): Promise<{ ok: boolean; error?: string; inviterName?: string | null; householdName?: string | null }> {
  const invite = await storage.getInviteByCode(code);
  if (!invite) return { ok: false, error: "Invite not found." };
  if (invite.used_at) return { ok: false, error: "This invite has already been used." };
  if (invite.expires_at < Date.now()) return { ok: false, error: "This invite has expired." };
  const inviter = await storage.getUser(invite.created_by);
  const household = await storage.getHouseholdForUser(invite.created_by);
  return { ok: true, inviterName: inviter?.displayName ?? null, householdName: household?.name ?? null };
}

/** Leaves the current household. Data is NOT deleted — the user just stops contributing to / seeing the shared view. */
export async function leaveHousehold(userId: number): Promise<{ changes: number }> {
  return storage.removeHouseholdMember(userId);
}

/**
 * Resolves which userIds' data should be included for a given scope.
 * "me" (or anything else) always returns just the requester. "shared"
 * returns every member of the requester's household, including
 * themself, or just the requester if they aren't in a household yet.
 */
export async function getScopedUserIds(userId: number, scope: string | undefined): Promise<number[]> {
  if (scope !== "shared") return [userId];
  const household = await storage.getHouseholdForUser(userId);
  if (!household) return [userId];
  return storage.getHouseholdMemberIds(household.id);
}
