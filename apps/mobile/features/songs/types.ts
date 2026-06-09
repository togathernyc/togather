/**
 * Shared frontend types for the native Song Library (ADR-027).
 *
 * These mirror the backend `songs` table contract. The rehearsal view imports
 * `Song` / `SongChart` from here, and the run sheet editor consumes the joined
 * `item.song` shape. Keep these in sync with `functions/scheduling/songs.ts`.
 */

/** A key-specific chart file attached to a song (PDF/image in R2). */
export interface SongChart {
  /** Musical key this chart is for (e.g. "G"); optional if key-agnostic. */
  key?: string;
  /** Human label shown in the UI (e.g. "Lead sheet (G)"). */
  label: string;
  /** R2 object key from the document-upload pipeline. */
  fileKey: string;
  /** MIME type of the uploaded file. */
  mimeType: string;
  /** Resolved view URL, populated by the backend on read. */
  url?: string;
}

/** A library song. Lives once per community; referenced by run sheet items. */
export interface Song {
  _id: string;
  communityId: string;
  title: string;
  author?: string;
  /** CCLI number — the universal worship-song ID; plain metadata for now. */
  ccliNumber?: string;
  defaultKey?: string;
  bpm?: number;
  meter?: string;
  arrangementName?: string;
  /** Section labels, e.g. ["Intro", "Verse 1", "Chorus"]. */
  structure?: string[];
  charts?: SongChart[];
  /** Link-out to where the multitrack stems live; never re-hosted audio. */
  multitracksUrl?: string;
  notes?: string;
}

/** Editable fields for create/update (charts are managed separately). */
export interface SongInput {
  title: string;
  author?: string;
  ccliNumber?: string;
  defaultKey?: string;
  bpm?: number;
  meter?: string;
  arrangementName?: string;
  structure?: string[];
  multitracksUrl?: string;
  notes?: string;
}
