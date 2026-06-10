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
import {
  action,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireAuthFromTokenAction } from "../../lib/auth";
import {
  getValidAccessToken,
  fetchAllSongs,
  fetchSongArrangements,
  fetchArrangementAttachments,
  openAttachmentUrl,
  downloadAttachmentBytes,
  PcoApiError,
  type PcoArrangement,
  type PcoSong,
  type PcoSongAttachment,
} from "../../lib/pcoServicesApi";
import { putR2Object } from "../../lib/r2";

/**
 * Map a PCO API failure to an actionable, user-facing message. A bare
 * `PcoApiError` would otherwise surface its raw status/stack in the client
 * dialog. 403 in particular is common here: the OAuth token is valid (it has
 * the `services` scope) but the connected Planning Center account lacks
 * permission to read the org's Services song library.
 */
function pcoImportError(err: unknown): ConvexError<string> {
  if (err instanceof PcoApiError) {
    if (err.status === 403) {
      return new ConvexError(
        "Planning Center denied access to your song library. The connected " +
          "Planning Center account needs Editor or Administrator access to " +
          "Services. Reconnect Planning Center with an account that has those " +
          "permissions, then try again.",
      );
    }
    if (err.status === 401) {
      return new ConvexError(
        "Your Planning Center connection has expired or was revoked. " +
          "Reconnect Planning Center and try again.",
      );
    }
    if (err.status === 429) {
      return new ConvexError(
        "Planning Center is rate-limiting the import. Wait a minute and try again.",
      );
    }
    return new ConvexError(
      `Planning Center returned an error (${err.status}). Please try again, or ` +
        "reconnect Planning Center if this persists.",
    );
  }
  return new ConvexError(
    "Something went wrong importing from Planning Center. Please try again.",
  );
}

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
// Church-uploaded chart filter (licensing guardrail, ADR-027)
// ============================================================================

/**
 * Content types we can store as a chart. PDFs and images are the chart formats
 * the rest of the song library already accepts (`uploads.ts` / SongLibrary
 * screen's document picker). Audio is allowed too — a church's own recorded
 * reference track is bring-your-own media it holds the rights to. Anything else
 * (Google Docs, video, octet-stream links) is skipped.
 */
const SUPPORTED_CHART_CONTENT_TYPES = new Set<string>([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/m4a",
  "audio/x-m4a",
  "audio/mp4",
]);

/**
 * Lower-cased substrings in `pco_type` that mark third-party / licensed sources
 * we must NOT re-host: SongSelect/CCLI (the church's license does not grant us
 * API re-hosting rights), PraiseCharts and MultiTracks (paid catalog content),
 * and pure link types (Spotify/Drive/Dropbox/YouTube/Vimeo) which are not files
 * we own anyway. A plain church upload's `pco_type` (e.g. "AttachmentTypes::S3"
 * / file upload) matches none of these.
 */
const BLOCKED_PCO_TYPE_SUBSTRINGS = [
  "songselect",
  "ccli",
  "praisecharts",
  "multitracks",
  "spotify",
  "youtube",
  "vimeo",
  "googledrive",
  "google_drive",
  "dropbox",
  "url",
  "link",
];

/**
 * Decide whether a PCO arrangement attachment is a church-uploaded chart we may
 * copy. CONSERVATIVE by design (the licensing guardrail): an attachment is
 * imported only when it is positively identifiable as the church's own file —
 * every ambiguous or third-party-sourced one is rejected (and counted as
 * skipped by the caller).
 *
 * An attachment is imported only if ALL hold:
 *  - it is `downloadable` (PCO itself permits download);
 *  - it carries NO CCLI/SongSelect license tracking (`licenses_purchased` etc.
 *    are null/0 — licensed content always tracks these);
 *  - it has NO `linked_url` or `remote_link` (a link-out, not an uploaded file);
 *  - its `pco_type` contains none of the blocked provider/link markers;
 *  - its `content_type` is a chart/audio format we support.
 *
 * The license-tracking + `pco_type` provider check is the primary signal that
 * distinguishes a SongSelect/CCLI chart from a file the church uploaded itself.
 */
export function isChurchUploadedChart(
  attachment: PcoSongAttachment,
): boolean {
  const a = attachment.attributes;

  if (!a.downloadable) return false;

  // Any CCLI/SongSelect license tracking → licensed content, never re-hosted.
  if ((a.licenses_purchased ?? 0) > 0) return false;
  if ((a.licenses_used ?? 0) > 0) return false;
  if ((a.licenses_remaining ?? 0) > 0) return false;

  // A linked/remote file is not an upload we own. PCO exposes link-outs via
  // either `linked_url` or `remote_link`; reject both.
  if (a.linked_url) return false;
  if (a.remote_link) return false;

  // Provider / link markers in pco_type are off-limits.
  const pcoType = (a.pco_type ?? "").toLowerCase();
  if (BLOCKED_PCO_TYPE_SUBSTRINGS.some((s) => pcoType.includes(s))) return false;

  // Only file types we can serve as charts.
  if (!SUPPORTED_CHART_CONTENT_TYPES.has(a.content_type)) return false;

  return true;
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
// Chart attach mutation + matching query (file import, ADR-027 Phase 2)
// ============================================================================

const importedChartValidator = v.object({
  key: v.optional(v.string()),
  label: v.string(),
  fileKey: v.string(),
  mimeType: v.string(),
});

/**
 * Minimal projection of a community's songs for matching imported PCO files
 * back to native song docs in the action. Returns each song's id, title, ccli,
 * and the labels of charts it already has (so the action skips re-downloading a
 * file it already imported — idempotent re-runs).
 *
 * Internal-only: the public action authenticates/permission-checks first.
 */
export const listCommunitySongsForMatching = internalQuery({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    const songs = await ctx.db
      .query("songs")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();
    return songs.map((s) => ({
      _id: s._id,
      title: s.title,
      ccliNumber: s.ccliNumber,
      chartLabels: (s.charts ?? []).map((c) => c.label),
    }));
  },
});

/**
 * Append charts to a song, skipping any whose `label` the song already has.
 * Idempotent: re-running the import never duplicates a chart. The label encodes
 * the PCO filename (+ key), so the same source file maps to the same label.
 *
 * Returns how many charts were actually added.
 *
 * Internal-only: the public action authenticates/permission-checks first.
 */
export const attachImportedCharts = internalMutation({
  args: {
    songId: v.id("songs"),
    charts: v.array(importedChartValidator),
  },
  handler: async (ctx, args): Promise<{ added: number }> => {
    const song = await ctx.db.get(args.songId);
    if (!song) return { added: 0 };

    const existing = song.charts ?? [];
    const existingLabels = new Set(existing.map((c) => c.label));
    const toAdd = args.charts.filter((c) => !existingLabels.has(c.label));
    if (toAdd.length === 0) return { added: 0 };

    await ctx.db.patch(args.songId, {
      charts: [...existing, ...toAdd],
      updatedAt: Date.now(),
    });
    return { added: toAdd.length };
  },
});

// ============================================================================
// Public action
// ============================================================================

// PCO rate limit is 100 requests per 20 seconds. We fetch arrangements 15 at a
// time AND pace the batches so the request *rate* stays under the limit (concur-
// rency alone doesn't bound rate): ~15 requests per 3.5s ≈ 86 req/20s. The
// fetchers also retry 429s honoring Retry-After, so this is belt-and-suspenders.
const BATCH_SIZE = 15;
const MIN_BATCH_INTERVAL_MS = 3500;

/** A native chart row resolved from a church-uploaded PCO attachment. */
interface ResolvedChart {
  key?: string;
  label: string;
  fileKey: string;
  mimeType: string;
}

/**
 * Build the chart `label` for an imported attachment. The label is the
 * idempotency key (re-runs skip a song's existing labels), so it must be stable
 * for the same source file: PCO's filename, suffixed with the arrangement key
 * when known (charts are key-specific in worship).
 */
function chartLabel(filename: string, key: string | undefined): string {
  const name = filename.trim() || "Chart";
  return key ? `${name} (${key})` : name;
}

/**
 * One-time import of the community's PCO Services song library into the
 * native `songs` table.
 *
 * Auth: community admin or group leader (`canManageSongs`); the community
 * must have a connected Planning Center integration.
 *
 * When `includeFiles` is true (the default), also copies each matched song's
 * CHURCH-UPLOADED chart/audio attachments out of PCO into R2 and attaches them
 * to the song (see `isChurchUploadedChart` for the licensing guardrail).
 *
 * Returns `{ imported, updated, skipped, total, filesImported, filesSkipped }`
 * — `total` is the number of library rows processed; `filesSkipped` counts
 * attachments rejected by the licensing/type guardrail.
 */
export const importSongsFromPco = action({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    includeFiles: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    imported: number;
    updated: number;
    skipped: number;
    total: number;
    filesImported: number;
    filesSkipped: number;
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
    //    fetchSongArrangements). PCO API failures (e.g. a 403 when the
    //    connected account can't read the song library) are mapped to a clear,
    //    actionable message rather than surfacing a raw stack trace.
    let pcoSongs: PcoSong[];
    const arrangementsBySongId = new Map<string, PcoArrangement[]>();
    try {
      pcoSongs = await fetchAllSongs(accessToken);

      for (let i = 0; i < pcoSongs.length; i += BATCH_SIZE) {
        const batchStart = Date.now();
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
        // Pace to stay under PCO's 100/20s rate limit; no wait after the last batch.
        const isLastBatch = i + BATCH_SIZE >= pcoSongs.length;
        if (!isLastBatch) {
          const elapsed = Date.now() - batchStart;
          if (elapsed < MIN_BATCH_INTERVAL_MS) {
            await new Promise((resolve) =>
              setTimeout(resolve, MIN_BATCH_INTERVAL_MS - elapsed),
            );
          }
        }
      }
    } catch (err) {
      throw pcoImportError(err);
    }

    // 4. Transform and upsert metadata.
    const songs = mapPcoSongs(pcoSongs, arrangementsBySongId);
    const counts: { imported: number; updated: number; skipped: number } =
      await ctx.runMutation(
        internal.functions.pcoServices.songImport.upsertImportedSongs,
        { communityId: args.communityId, userId, songs },
      );

    // 5. Optionally copy church-uploaded chart files into R2 and attach them.
    let filesImported = 0;
    let filesSkipped = 0;
    if (args.includeFiles ?? true) {
      // Best-effort: metadata is already committed above, so a permission or
      // network failure while copying files must not fail the whole import.
      // Re-running is idempotent and will retry the files.
      try {
        const fileResult = await importSongFiles(ctx, {
          communityId: args.communityId,
          accessToken,
          pcoSongs,
          arrangementsBySongId,
        });
        filesImported = fileResult.filesImported;
        filesSkipped = fileResult.filesSkipped;
      } catch {
        // Swallow — songs imported; files can be retried on the next run.
      }
    }

    return {
      ...counts,
      total: songs.length,
      filesImported,
      filesSkipped,
    };
  },
});

/**
 * Copy each matched song's church-uploaded chart attachments from PCO into R2
 * and attach them to the native song. Shared by the action; pulled out to keep
 * the handler readable.
 *
 * Matching mirrors the metadata upsert: a PCO song maps to a native song by
 * CCLI number, else case-insensitive title. Attachments live on the song's
 * arrangements; we fetch them in the same paced batches and apply the
 * `isChurchUploadedChart` guardrail. Re-runs are idempotent — the attach
 * mutation skips charts whose label already exists, and we skip whole songs
 * whose existing chart labels already cover the source file.
 */
async function importSongFiles(
  ctx: ActionCtx,
  params: {
    communityId: Id<"communities">;
    accessToken: string;
    pcoSongs: PcoSong[];
    arrangementsBySongId: Map<string, PcoArrangement[]>;
  },
): Promise<{ filesImported: number; filesSkipped: number }> {
  const { communityId, accessToken, pcoSongs, arrangementsBySongId } = params;

  // Build CCLI/title → native song lookup so we can attach to the right doc.
  const nativeSongs = await ctx.runQuery(
    internal.functions.pcoServices.songImport.listCommunitySongsForMatching,
    { communityId },
  );
  const byCcli = new Map<string, (typeof nativeSongs)[number]>();
  const byTitle = new Map<string, (typeof nativeSongs)[number]>();
  for (const s of nativeSongs) {
    if (s.ccliNumber) byCcli.set(s.ccliNumber, s);
    if (!byTitle.has(s.title.toLowerCase())) byTitle.set(s.title.toLowerCase(), s);
  }

  // Existing chart labels per native song id — to skip already-imported files
  // before doing any network work (idempotent re-runs make no PCO requests).
  const existingLabels = new Map<string, Set<string>>(
    nativeSongs.map((s) => [s._id, new Set(s.chartLabels)]),
  );

  let filesImported = 0;
  let filesSkipped = 0;

  for (let i = 0; i < pcoSongs.length; i += BATCH_SIZE) {
    const batchStart = Date.now();
    const batch = pcoSongs.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (pcoSong) => {
        // Resolve which native song this maps to (CCLI first, else title).
        const ccli =
          pcoSong.attributes.ccli_number == null
            ? undefined
            : String(pcoSong.attributes.ccli_number).trim() || undefined;
        const title = pcoSong.attributes.title?.trim();
        const native =
          (ccli ? byCcli.get(ccli) : undefined) ??
          (title ? byTitle.get(title.toLowerCase()) : undefined);
        if (!native) return;

        const arrangement = arrangementsBySongId.get(pcoSong.id)?.[0];
        if (!arrangement) return;

        let attachments: PcoSongAttachment[];
        try {
          attachments = await fetchArrangementAttachments(
            accessToken,
            pcoSong.id,
            arrangement.id,
          );
        } catch {
          // A single song's attachment fetch failing must not abort the import.
          return;
        }

        const labels = existingLabels.get(native._id) ?? new Set<string>();
        const charts: ResolvedChart[] = [];

        for (const attachment of attachments) {
          if (!isChurchUploadedChart(attachment)) {
            filesSkipped++;
            continue;
          }
          const key = arrangement.attributes.chord_chart_key?.trim() || undefined;
          const label = chartLabel(attachment.attributes.filename, key);
          // Idempotency: skip a file we already imported for this song.
          if (labels.has(label)) continue;

          let url = attachment.attributes.url;
          if (!url) {
            url = await openAttachmentUrl(
              accessToken,
              pcoSong.id,
              arrangement.id,
              attachment.id,
            );
          }
          if (!url) {
            filesSkipped++;
            continue;
          }

          let bytes: ArrayBuffer;
          try {
            bytes = await downloadAttachmentBytes(url);
          } catch {
            filesSkipped++;
            continue;
          }

          const { storagePath } = await putR2Object({
            folder: "uploads",
            fileName: attachment.attributes.filename,
            contentType: attachment.attributes.content_type,
            body: bytes,
          });

          charts.push({
            ...(key ? { key } : {}),
            label,
            fileKey: storagePath,
            mimeType: attachment.attributes.content_type,
          });
          labels.add(label);
        }

        if (charts.length > 0) {
          const { added } = await ctx.runMutation(
            internal.functions.pcoServices.songImport.attachImportedCharts,
            { songId: native._id, charts },
          );
          filesImported += added;
        }
      }),
    );

    // Same pacing as the arrangement fetch — stay under 100 req/20s.
    const isLastBatch = i + BATCH_SIZE >= pcoSongs.length;
    if (!isLastBatch) {
      const elapsed = Date.now() - batchStart;
      if (elapsed < MIN_BATCH_INTERVAL_MS) {
        await new Promise((resolve) =>
          setTimeout(resolve, MIN_BATCH_INTERVAL_MS - elapsed),
        );
      }
    }
  }

  return { filesImported, filesSkipped };
}
