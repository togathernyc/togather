/**
 * One-time PCO song library import (ADR-027 open question #2)
 *
 * A migration aid for churches moving off Planning Center: fetches the
 * community's entire PCO Services song library (title, author, CCLI number,
 * and the first arrangement's key/BPM/meter/name) and upserts it into the
 * native `songs` table. Import is additive and never clobbers user edits —
 * matched songs only have their *missing* fields filled.
 *
 * Dedupe rules: a row carrying a CCLI number matches an existing song by
 * `ccliNumber` (the worship world's universal song ID, via the
 * `by_community_ccli` index); failing that, it enriches a same-title song that
 * has no CCLI yet (rather than create a duplicate), but never one that already
 * carries a different CCLI. A row without a CCLI matches by case-insensitive
 * title within the community.
 */

import { ConvexError, v } from "convex/values";
import { action, internalMutation } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireAuthFromTokenAction } from "../../lib/auth";
import {
  getValidAccessToken,
  fetchAllSongs,
  fetchSongArrangements,
  type PcoArrangement,
  type PcoSong,
} from "../../lib/pcoServicesApi";

// ============================================================================
// Pure transform
// ============================================================================

/** One import row — the subset of `songs` fields PCO can provide. */
export interface ImportedSongInput {
  title: string;
  author?: string;
  ccliNumber?: string;
  defaultKey?: string;
  bpm?: number;
  meter?: string;
  arrangementName?: string;
}

/** Trimmed string, or undefined when null/blank. */
function cleanString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Map PCO songs (plus each song's arrangements) to `ImportedSongInput` rows.
 *
 * Key/BPM/meter/arrangement-name come from the FIRST arrangement — PCO songs
 * can have several, and the first is the default. Songs with blank titles are
 * skipped. Null/blank attributes are omitted (not set to undefined) so the
 * rows serialize cleanly as Convex values.
 */
export function mapPcoSongs(
  songs: PcoSong[],
  arrangementsBySongId: Map<string, PcoArrangement[]>,
): ImportedSongInput[] {
  const rows: ImportedSongInput[] = [];

  for (const song of songs) {
    const title = cleanString(song.attributes.title);
    if (!title) continue;

    const row: ImportedSongInput = { title };

    const author = cleanString(song.attributes.author);
    if (author) row.author = author;

    // PCO types ccli_number as a string but has been seen returning numbers;
    // normalize defensively since it's our dedupe key.
    const ccliNumber = cleanString(
      song.attributes.ccli_number == null
        ? undefined
        : String(song.attributes.ccli_number),
    );
    if (ccliNumber) row.ccliNumber = ccliNumber;

    const arrangement = arrangementsBySongId.get(song.id)?.[0];
    if (arrangement) {
      const defaultKey = cleanString(arrangement.attributes.chord_chart_key);
      if (defaultKey) row.defaultKey = defaultKey;
      if (arrangement.attributes.bpm != null) {
        row.bpm = arrangement.attributes.bpm;
      }
      const meter = cleanString(arrangement.attributes.meter);
      if (meter) row.meter = meter;
      const arrangementName = cleanString(arrangement.attributes.name);
      if (arrangementName) row.arrangementName = arrangementName;
    }

    rows.push(row);
  }

  return rows;
}

// ============================================================================
// Upsert mutation
// ============================================================================

const importedSongValidator = v.object({
  title: v.string(),
  author: v.optional(v.string()),
  ccliNumber: v.optional(v.string()),
  defaultKey: v.optional(v.string()),
  bpm: v.optional(v.number()),
  meter: v.optional(v.string()),
  arrangementName: v.optional(v.string()),
});

/** The import-fillable metadata fields, shared by the fill loop below. */
const FILLABLE_FIELDS = [
  "author",
  "ccliNumber",
  "defaultKey",
  "bpm",
  "meter",
  "arrangementName",
] as const;

/**
 * Upsert imported rows into the community's `songs` table.
 *
 * - No match → insert (`createdById` = the importing user).
 * - Match → fill ONLY fields the existing song is missing; never overwrite.
 *   Something filled counts as `updated`, nothing to fill counts as `skipped`.
 *
 * Internal-only: the public `importSongsFromPco` action authenticates and
 * permission-checks before calling this.
 */
export const upsertImportedSongs = internalMutation({
  args: {
    communityId: v.id("communities"),
    userId: v.id("users"),
    songs: v.array(importedSongValidator),
  },
  handler: async (ctx, args) => {
    // One indexed read, then in-memory lookup maps. Both maps are kept
    // current as we insert/patch so duplicate rows within the same import
    // batch dedupe against each other too.
    const existing = await ctx.db
      .query("songs")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();
    const byCcli = new Map<string, Doc<"songs">>();
    const byTitle = new Map<string, Doc<"songs">>();
    for (const song of existing) {
      if (song.ccliNumber) byCcli.set(song.ccliNumber, song);
      if (!byTitle.has(song.title.toLowerCase())) {
        byTitle.set(song.title.toLowerCase(), song);
      }
    }

    let imported = 0;
    let updated = 0;
    let skipped = 0;

    for (const row of args.songs) {
      // Match priority:
      //   - row has a CCLI → match that CCLI; if none, fall back to a title
      //     match that has NO CCLI yet (enrich a manually-entered song rather
      //     than create a duplicate), but never a title match that already
      //     carries a *different* CCLI (those are distinct songs).
      //   - row has no CCLI → match by title.
      let match: Doc<"songs"> | undefined;
      if (row.ccliNumber) {
        match = byCcli.get(row.ccliNumber);
        if (!match) {
          const titleMatch = byTitle.get(row.title.toLowerCase());
          if (titleMatch && !titleMatch.ccliNumber) match = titleMatch;
        }
      } else {
        match = byTitle.get(row.title.toLowerCase());
      }

      if (!match) {
        const nowMs = Date.now();
        const songId = await ctx.db.insert("songs", {
          communityId: args.communityId,
          ...row,
          createdAt: nowMs,
          createdById: args.userId,
          updatedAt: nowMs,
        });
        const inserted = (await ctx.db.get(songId))!;
        if (inserted.ccliNumber) byCcli.set(inserted.ccliNumber, inserted);
        if (!byTitle.has(inserted.title.toLowerCase())) {
          byTitle.set(inserted.title.toLowerCase(), inserted);
        }
        imported++;
        continue;
      }

      // Fill only the fields the existing song is missing.
      const patch: Partial<Doc<"songs">> = {};
      for (const field of FILLABLE_FIELDS) {
        if (match[field] === undefined && row[field] !== undefined) {
          patch[field] = row[field] as never;
        }
      }

      if (Object.keys(patch).length === 0) {
        skipped++;
        continue;
      }

      patch.updatedAt = Date.now();
      await ctx.db.patch(match._id, patch);
      const patched = (await ctx.db.get(match._id))!;
      if (patched.ccliNumber) byCcli.set(patched.ccliNumber, patched);
      byTitle.set(patched.title.toLowerCase(), patched);
      updated++;
    }

    return { imported, updated, skipped };
  },
});

// ============================================================================
// Public action
// ============================================================================

// PCO rate limit is 100 requests per 20 seconds; 15 concurrent arrangement
// fetches per batch is the established safe convention (see actions.ts).
const BATCH_SIZE = 15;

/**
 * One-time import of the community's PCO Services song library into the
 * native `songs` table.
 *
 * Auth: community admin or group leader (`canManageSongs`); the community
 * must have a connected Planning Center integration.
 *
 * Returns `{ imported, updated, skipped, total }` — `total` is the number of
 * library rows processed (imported + updated + skipped).
 */
export const importSongsFromPco = action({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    imported: number;
    updated: number;
    skipped: number;
    total: number;
  }> => {
    // 1. Authenticate and check song-library permission. Guards like
    //    requireCommunitySongEditor need query/mutation ctx, so the action
    //    delegates to the canManageSongs query.
    const userId = (await requireAuthFromTokenAction(
      ctx,
      args.token,
    )) as Id<"users">;
    const allowed = await ctx.runQuery(
      api.functions.scheduling.songs.canManageSongs,
      { token: args.token, communityId: args.communityId },
    );
    if (!allowed) {
      throw new ConvexError(
        "You must be a group leader or community admin to import songs",
      );
    }

    // 2. Require a connected PCO integration (clear error before we try to
    //    use its tokens).
    const integration = await ctx.runQuery(
      internal.functions.pcoServices.queries.getIntegration,
      { communityId: args.communityId },
    );
    if (!integration || integration.status !== "connected") {
      throw new ConvexError("Planning Center is not connected");
    }
    const accessToken = await getValidAccessToken(ctx, args.communityId);

    // 3. Fetch the whole library, then each song's arrangements in batches
    //    (the songs endpoint has no `include=arrangements`; see
    //    fetchSongArrangements).
    const pcoSongs = await fetchAllSongs(accessToken);

    const arrangementsBySongId = new Map<string, PcoArrangement[]>();
    for (let i = 0; i < pcoSongs.length; i += BATCH_SIZE) {
      const batch = pcoSongs.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(
          async (song) =>
            [song.id, await fetchSongArrangements(accessToken, song.id)] as const,
        ),
      );
      for (const [songId, arrangements] of results) {
        arrangementsBySongId.set(songId, arrangements);
      }
    }

    // 4. Transform and upsert.
    const songs = mapPcoSongs(pcoSongs, arrangementsBySongId);
    const counts: { imported: number; updated: number; skipped: number } =
      await ctx.runMutation(
        internal.functions.pcoServices.songImport.upsertImportedSongs,
        { communityId: args.communityId, userId, songs },
      );

    return { ...counts, total: songs.length };
  },
});
