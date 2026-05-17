/**
 * Typed function references for the cross-team channel backend.
 *
 * Why this file exists: the Convex backend module
 * `functions/scheduling/crossTeamChannels` is deployed, but the committed
 * `apps/convex/_generated/api.d.ts` in this repo can be stale offline and not
 * yet list it. Accessing `api.functions.scheduling.crossTeamChannels.*`
 * directly would therefore be a type error until the next `npx convex dev`
 * regenerates the api map.
 *
 * Rather than scattering `as any` casts across the UI, we isolate a single
 * typed indirection here: at runtime the app's `api` IS `anyApi` (a proxy that
 * resolves any path), so `(api as AnyApiShape)....` resolves correctly; we
 * then re-assert the precise `FunctionReference` arg/return types — matching
 * the validators in `crossTeamChannels.ts` — so every call site is fully
 * type-checked. Once the generated api map includes the module, this file can
 * be deleted and call sites can use `api.functions.scheduling.crossTeamChannels`
 * directly.
 */
import type { FunctionReference } from "convex/server";
import { api, type Id } from "@services/api/convex";

/** One cross-team membership selector: a source team channel + optional role. */
export type CrossTeamSelector = {
  sourceChannelId: Id<"chatChannels">;
  roleId?: Id<"teamRoles">;
};

/** A selector enriched with display names, as returned by `listCrossTeamChannels`. */
export type EnrichedCrossTeamSelector = {
  sourceChannelId: Id<"chatChannels">;
  sourceChannelName: string;
  roleId: Id<"teamRoles"> | null;
  roleName: string | null;
};

export type CrossTeamChannel = {
  _id: Id<"chatChannels">;
  name: string;
  description?: string;
  channelType: string;
  memberCount: number;
  selectors: EnrichedCrossTeamSelector[];
};

type CreateCrossTeamChannelRef = FunctionReference<
  "mutation",
  "public",
  {
    token: string;
    groupId: Id<"groups">;
    name: string;
    description?: string;
    selectors: CrossTeamSelector[];
  },
  { channelId: Id<"chatChannels">; slug: string }
>;

type UpdateCrossTeamChannelRef = FunctionReference<
  "mutation",
  "public",
  {
    token: string;
    channelId: Id<"chatChannels">;
    selectors: CrossTeamSelector[];
  },
  { channelId: Id<"chatChannels">; addedCount: number; removedCount: number }
>;

type ListCrossTeamChannelsRef = FunctionReference<
  "query",
  "public",
  { token: string; groupId: Id<"groups"> },
  CrossTeamChannel[]
>;

// The runtime `api` is `anyApi`, so any property path resolves to a valid
// function reference proxy. We narrow the path's type to the precise
// reference above. This is the single, intentional cast — see file header.
const crossTeamChannelsApi = (
  api as unknown as {
    functions: {
      scheduling: {
        crossTeamChannels: {
          createCrossTeamChannel: CreateCrossTeamChannelRef;
          updateCrossTeamChannel: UpdateCrossTeamChannelRef;
          listCrossTeamChannels: ListCrossTeamChannelsRef;
        };
      };
    };
  }
).functions.scheduling.crossTeamChannels;

export const createCrossTeamChannelRef =
  crossTeamChannelsApi.createCrossTeamChannel;
export const updateCrossTeamChannelRef =
  crossTeamChannelsApi.updateCrossTeamChannel;
export const listCrossTeamChannelsRef =
  crossTeamChannelsApi.listCrossTeamChannels;
