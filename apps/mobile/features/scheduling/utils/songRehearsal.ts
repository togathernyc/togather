/**
 * Musician rehearsal helpers (ADR-027).
 *
 * A run sheet `song` item resolves its display key/BPM by layering a
 * per-occurrence override (`item.songDetails`) over the library song's defaults
 * (`item.song`). Worship teams routinely transpose the same song week to week,
 * so the override always wins when present; otherwise the library default shows.
 *
 * The resolution itself lives once in `features/songs/utils/songOverride`; these
 * are thin item-shaped adapters so the rehearsal view can resolve values from a
 * whole run sheet item without touching Convex.
 */
import type { Song, SongChart } from "@features/songs/types";
import {
  resolveSongBpm,
  resolveSongKey,
} from "@features/songs/utils/songOverride";

export type { Song, SongChart };

/**
 * The slice of a run sheet item this module reads. `song` is widened to a
 * partial of the library `Song` because the resolvers only touch `defaultKey` /
 * `bpm`, and callers (and tests) supply just the joined fields they have.
 */
export interface SongRehearsalItem {
  songDetails?: { key?: string; bpm?: number; author?: string } | null;
  song?: Partial<Song> | null;
}

/** Effective display key: per-occurrence override, else the song's default. */
export function effectiveKey(item: SongRehearsalItem): string | undefined {
  return resolveSongKey(item.songDetails, item.song);
}

/** Effective display BPM: per-occurrence override, else the song's default. */
export function effectiveBpm(item: SongRehearsalItem): number | undefined {
  return resolveSongBpm(item.songDetails, item.song);
}
