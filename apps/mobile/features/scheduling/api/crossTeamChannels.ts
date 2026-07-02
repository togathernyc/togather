/**
 * Typed function references for the cross-team channel backend.
 *
 * Why this file exists: the Convex backend module
 * `functions/scheduling/crossTeamChannels` is deployed, but the committed
 * `apps/convex/_generated/api.d.ts` in this repo can be stale offline and not
 * yet list it — so `api.functions.scheduling.crossTeamChannels.*` would be a
 * type error until the next `npx convex dev` regenerates the api map.
 *
 * Rather than depend on the generated `api` object, we build the references
 * directly from their function paths with `makeFunctionReference`, asserting
 * the precise arg/return types — matching the validators in
 * `crossTeamChannels.ts`. This is fully type-checked at every call site and,
 * unlike traversing the `api` proxy, evaluates safely under test mocks. Once
 * the generated api map includes the module, this file can be deleted and
 * call sites can use `api.functions.scheduling.crossTeamChannels` directly.
 */
import { makeFunctionReference } from "convex/server";
import type { Id } from "@services/api/convex";

/** One cross-team membership selector: a source team + optional role. */
export type CrossTeamSelector = {
  sourceTeamId: Id<"teams">;
  roleId?: Id<"teamRoles">;
};

/** A selector enriched with display names, as returned by `listCrossTeamChannels`. */
export type EnrichedCrossTeamSelector = {
  sourceTeamId: Id<"teams">;
  sourceTeamName: string;
  roleId: Id<"teamRoles"> | null;
  roleName: string | null;
};

export type CrossTeamChannel = {
  _id: Id<"chatChannels">;
  /** Channel slug — used to route into Channel Info to edit synced roles. */
  slug?: string;
  name: string;
  description?: string;
  channelType: string;
  memberCount: number;
  selectors: EnrichedCrossTeamSelector[];
};

export const createCrossTeamChannelRef = makeFunctionReference<
  "mutation",
  {
    token: string;
    groupId: Id<"groups">;
    name: string;
    description?: string;
    selectors: CrossTeamSelector[];
  },
  { channelId: Id<"chatChannels">; slug: string }
>("functions/scheduling/crossTeamChannels:createCrossTeamChannel");

export const updateCrossTeamChannelRef = makeFunctionReference<
  "mutation",
  {
    token: string;
    channelId: Id<"chatChannels">;
    selectors: CrossTeamSelector[];
  },
  { channelId: Id<"chatChannels">; addedCount: number; removedCount: number }
>("functions/scheduling/crossTeamChannels:updateCrossTeamChannel");

export const listCrossTeamChannelsRef = makeFunctionReference<
  "query",
  { token: string; groupId: Id<"groups"> },
  CrossTeamChannel[]
>("functions/scheduling/crossTeamChannels:listCrossTeamChannels");

/** A manually pinned ("Permanent") member of a cross-team channel. */
export type CrossTeamPermanentMember = {
  userId: Id<"users">;
  name: string;
  avatarUrl?: string;
};

/** A live role-matched ("Synced by role") member — one per (user, role). */
export type CrossTeamSyncedRoleMember = {
  userId: Id<"users">;
  name: string;
  avatarUrl?: string;
  roleId: Id<"teamRoles">;
  roleName: string;
  teamId: Id<"teams">;
  teamName: string;
};

/** The two-section Channel Info membership for a cross-team channel. */
export type CrossTeamChannelMembership = {
  permanentMembers: CrossTeamPermanentMember[];
  syncedRoleMembers: CrossTeamSyncedRoleMember[];
};

export const getCrossTeamChannelMembershipRef = makeFunctionReference<
  "query",
  { token: string; channelId: Id<"chatChannels"> },
  CrossTeamChannelMembership
>("functions/scheduling/crossTeamChannels:getCrossTeamChannelMembership");

export const addPermanentMemberToChannelRef = makeFunctionReference<
  "mutation",
  { token: string; channelId: Id<"chatChannels">; userId: Id<"users"> },
  { channelId: Id<"chatChannels">; userId: Id<"users">; added: boolean }
>("functions/scheduling/crossTeamChannels:addPermanentMemberToChannel");

export const removePermanentMemberFromChannelRef = makeFunctionReference<
  "mutation",
  { token: string; channelId: Id<"chatChannels">; userId: Id<"users"> },
  { channelId: Id<"chatChannels">; userId: Id<"users">; removed: boolean }
>("functions/scheduling/crossTeamChannels:removePermanentMemberFromChannel");
