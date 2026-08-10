/**
 * Per-service override resolution for library-linked run sheet songs (ADR-027).
 *
 * A library `Song` carries the *defaults* (defaultKey, bpm); a run sheet item
 * may override them for a specific service via its `songDetails` blob — worship
 * teams routinely transpose the same song week to week. Display resolves the
 * override first, then the library default.
 */
import type { Song } from "../types";

type SongDetails = { key?: string; bpm?: number } | null | undefined;

/** Resolved key for display: per-item override, else the song's default. */
export function resolveSongKey(
  songDetails: SongDetails,
  song: Pick<Song, "defaultKey"> | null | undefined,
): string | undefined {
  return songDetails?.key ?? song?.defaultKey ?? undefined;
}

/** Resolved BPM for display: per-item override, else the song's default. */
export function resolveSongBpm(
  songDetails: SongDetails,
  song: Pick<Song, "bpm"> | null | undefined,
): number | undefined {
  return songDetails?.bpm ?? song?.bpm ?? undefined;
}
