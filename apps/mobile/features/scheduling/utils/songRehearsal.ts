/**
 * Musician rehearsal helpers (ADR-027).
 *
 * A run sheet `song` item resolves its display key/BPM by layering a
 * per-occurrence override (`item.songDetails`) over the library song's defaults
 * (`item.song`). Worship teams routinely transpose the same song week to week,
 * so the override always wins when present; otherwise the library default shows.
 *
 * These are pure so the rehearsal view (and tests) can resolve values without
 * touching Convex.
 */

// TODO(integration): import { Song } from "features/songs/types" once the shared
// types file lands. Until then this minimal local fallback mirrors that shape.
export interface SongChart {
  key?: string;
  label: string;
  fileKey: string;
  mimeType: string;
  url?: string;
}

export interface Song {
  _id: string;
  title: string;
  author?: string;
  ccliNumber?: string;
  defaultKey?: string;
  bpm?: number;
  meter?: string;
  arrangementName?: string;
  structure?: string[];
  charts?: SongChart[];
  multitracksUrl?: string;
}

/** The slice of a run sheet item this module reads. */
export interface SongRehearsalItem {
  songDetails?: { key?: string; bpm?: number; author?: string } | null;
  song?: Song | null;
}

/** Effective display key: per-occurrence override, else the song's default. */
export function effectiveKey(item: SongRehearsalItem): string | undefined {
  return item.songDetails?.key ?? item.song?.defaultKey;
}

/** Effective display BPM: per-occurrence override, else the song's default. */
export function effectiveBpm(item: SongRehearsalItem): number | undefined {
  return item.songDetails?.bpm ?? item.song?.bpm;
}
