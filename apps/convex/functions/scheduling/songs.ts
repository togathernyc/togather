/**
 * Scheduling — native song library (ADR-027)
 *
 * A per-community library of songs that run sheet `eventItems` reference by
 * `songId`. A song lives once; editing it updates every plan that uses it.
 * `ccliNumber` is the worship world's universal song ID, stored as plain
 * metadata (no live CCLI/MultiTracks integration). Charts are key-specific
 * files in the existing R2 upload pipeline (`functions/uploads.ts`) — we store
 * the `fileKey` and resolve the served `url` on read via `getMediaUrl`, the same
 * helper other media features use. `multitracksUrl` is a link-out, never audio.
 *
 * Permissions reuse existing guards: editing the library is a community-admin
 * action (`requireCommunityAdmin`); listing/viewing requires an active
 * community member (`requireCommunityMember`). Linking a song to a run sheet
 * item lives in `eventItems.updateItem` and reuses `requirePlanScheduler`.
 */

import { ConvexError, v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { getMediaUrl } from "../../lib/utils";
import { requireCommunityAdmin, requireCommunityMember } from "./permissions";

/** Editable song fields shared by create (`input`) and update (`patch`). */
const songInputValidator = v.object({
  title: v.optional(v.string()),
  author: v.optional(v.string()),
  ccliNumber: v.optional(v.string()),
  defaultKey: v.optional(v.string()),
  bpm: v.optional(v.number()),
  meter: v.optional(v.string()),
  arrangementName: v.optional(v.string()),
  structure: v.optional(v.array(v.string())),
  multitracksUrl: v.optional(v.string()),
  notes: v.optional(v.string()),
});

const chartValidator = v.object({
  key: v.optional(v.string()),
  label: v.string(),
  fileKey: v.string(),
  mimeType: v.string(),
});

/**
 * The client-facing Song shape: the stored doc with each chart's served `url`
 * resolved from its `fileKey`. Charts default to `[]` so the client never has
 * to null-check the array.
 */
function hydrateSong(song: Doc<"songs">) {
  return {
    ...song,
    charts: (song.charts ?? []).map((chart) => ({
      ...chart,
      url: getMediaUrl(chart.fileKey) ?? null,
    })),
  };
}

/**
 * Resolve a song and assert the caller may edit its community library.
 *
 * @throws ConvexError if the song is missing or the caller is not an admin.
 */
async function requireSongAdmin(
  ctx: MutationCtx,
  songId: Id<"songs">,
  userId: Id<"users">,
): Promise<Doc<"songs">> {
  const song = await ctx.db.get(songId);
  if (!song) {
    throw new ConvexError("Song not found");
  }
  await requireCommunityAdmin(ctx, song.communityId, userId);
  return song;
}

/**
 * List a community's songs, sorted by title (case-insensitive). When `search`
 * is given, keep only songs whose title or `ccliNumber` contains it.
 *
 * Auth: active community member.
 */
export const listSongs = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityMember(ctx, args.communityId, userId);

    let songs = await ctx.db
      .query("songs")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();

    const search = args.search?.trim().toLowerCase();
    if (search) {
      songs = songs.filter(
        (s) =>
          s.title.toLowerCase().includes(search) ||
          (s.ccliNumber ?? "").toLowerCase().includes(search),
      );
    }

    songs.sort((a, b) =>
      a.title.toLowerCase().localeCompare(b.title.toLowerCase()),
    );

    return songs.map(hydrateSong);
  },
});

/**
 * Get a single song with its chart urls resolved, or null if it does not exist.
 *
 * Auth: active member of the song's community.
 */
export const getSong = query({
  args: {
    token: v.string(),
    songId: v.id("songs"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const song = await ctx.db.get(args.songId);
    if (!song) return null;
    await requireCommunityMember(ctx, song.communityId, userId);
    return hydrateSong(song);
  },
});

/**
 * Create a library song. Charts are attached separately via `attachChart`.
 *
 * Auth: community admin.
 */
export const createSong = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    input: songInputValidator,
  },
  handler: async (ctx, args): Promise<Id<"songs">> => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const title = (args.input.title ?? "").trim();
    if (!title) {
      throw new ConvexError("Song title cannot be empty");
    }

    const nowMs = Date.now();
    return ctx.db.insert("songs", {
      communityId: args.communityId,
      title,
      author: args.input.author?.trim() || undefined,
      ccliNumber: args.input.ccliNumber?.trim() || undefined,
      defaultKey: args.input.defaultKey?.trim() || undefined,
      bpm: args.input.bpm,
      meter: args.input.meter?.trim() || undefined,
      arrangementName: args.input.arrangementName?.trim() || undefined,
      structure: args.input.structure,
      multitracksUrl: args.input.multitracksUrl?.trim() || undefined,
      notes: args.input.notes?.trim() || undefined,
      createdAt: nowMs,
      createdById: userId,
      updatedAt: nowMs,
    });
  },
});

/**
 * Update a song's metadata. Only provided fields change; `updatedAt` bumps.
 *
 * Auth: community admin for the song's community.
 */
export const updateSong = mutation({
  args: {
    token: v.string(),
    songId: v.id("songs"),
    patch: songInputValidator,
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireSongAdmin(ctx, args.songId, userId);

    const patch: Partial<Doc<"songs">> = { updatedAt: Date.now() };
    const p = args.patch;
    if (p.title !== undefined) {
      const title = p.title.trim();
      if (!title) {
        throw new ConvexError("Song title cannot be empty");
      }
      patch.title = title;
    }
    if (p.author !== undefined) patch.author = p.author.trim() || undefined;
    if (p.ccliNumber !== undefined)
      patch.ccliNumber = p.ccliNumber.trim() || undefined;
    if (p.defaultKey !== undefined)
      patch.defaultKey = p.defaultKey.trim() || undefined;
    if (p.bpm !== undefined) patch.bpm = p.bpm;
    if (p.meter !== undefined) patch.meter = p.meter.trim() || undefined;
    if (p.arrangementName !== undefined)
      patch.arrangementName = p.arrangementName.trim() || undefined;
    if (p.structure !== undefined) patch.structure = p.structure;
    if (p.multitracksUrl !== undefined)
      patch.multitracksUrl = p.multitracksUrl.trim() || undefined;
    if (p.notes !== undefined) patch.notes = p.notes.trim() || undefined;

    await ctx.db.patch(args.songId, patch);
    return { songId: args.songId };
  },
});

/**
 * Delete a song. First null out `songId` on every run sheet item that
 * references it — the item survives, falling back to its `songDetails`/title —
 * then delete the song (ADR-027). Uses the `eventItems.by_song` index.
 *
 * Auth: community admin for the song's community.
 */
export const deleteSong = mutation({
  args: {
    token: v.string(),
    songId: v.id("songs"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireSongAdmin(ctx, args.songId, userId);

    const referencing = await ctx.db
      .query("eventItems")
      .withIndex("by_song", (q) => q.eq("songId", args.songId))
      .collect();
    await Promise.all(
      referencing.map((item) =>
        ctx.db.patch(item._id, { songId: undefined, updatedAt: Date.now() }),
      ),
    );

    await ctx.db.delete(args.songId);
    return { deleted: true, unlinkedItems: referencing.length };
  },
});

/**
 * Append a chart to a song's `charts` array. The `fileKey` is the R2 stored
 * path from the upload pipeline; its served url is resolved on read.
 *
 * Auth: community admin for the song's community.
 */
export const attachChart = mutation({
  args: {
    token: v.string(),
    songId: v.id("songs"),
    chart: chartValidator,
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const song = await requireSongAdmin(ctx, args.songId, userId);

    const charts = [...(song.charts ?? []), args.chart];
    await ctx.db.patch(args.songId, { charts, updatedAt: Date.now() });
    return { songId: args.songId };
  },
});

/**
 * Remove the chart with the given `fileKey` from a song's `charts` array.
 *
 * Auth: community admin for the song's community.
 */
export const removeChart = mutation({
  args: {
    token: v.string(),
    songId: v.id("songs"),
    fileKey: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const song = await requireSongAdmin(ctx, args.songId, userId);

    const charts = (song.charts ?? []).filter((c) => c.fileKey !== args.fileKey);
    await ctx.db.patch(args.songId, { charts, updatedAt: Date.now() });
    return { songId: args.songId };
  },
});

/**
 * Internal: resolve a song to the client-facing Song shape (charts with urls),
 * or null. Shared by `eventItems`/`events` so a run sheet item can join its
 * linked song without a client round-trip. Skips the membership guard — callers
 * have already gated on the plan's group, which is scoped to the community.
 */
export async function getHydratedSongForJoin(
  ctx: QueryCtx,
  songId: Id<"songs"> | undefined,
) {
  if (!songId) return null;
  const song = await ctx.db.get(songId);
  return song ? hydrateSong(song) : null;
}
