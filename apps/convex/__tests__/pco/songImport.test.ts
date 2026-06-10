/**
 * Tests for the one-time PCO song library import (ADR-027 open question #2).
 *
 * Covers:
 *  - `mapPcoSongs` — pure transform of PCO songs + arrangements into
 *    `ImportedSongInput` rows (first arrangement wins, blank titles skipped,
 *    null attributes omitted).
 *  - `upsertImportedSongs` — internalMutation dedupe/upsert into the native
 *    `songs` table (match by ccli, else case-insensitive title; fill only
 *    missing fields; imported/updated/skipped counts).
 *  - `importSongsFromPco` — the public action's permission gate, "not
 *    connected" error, and happy path (PCO HTTP layer mocked).
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { generateTokens } from "../../lib/auth";
import { api, internal } from "../../_generated/api";
import { buildSchedulingWorld } from "../scheduling/fixtures";
import { mapPcoSongs } from "../../functions/pcoServices/songImport";
import type { PcoArrangement, PcoSong } from "../../lib/pcoServicesApi";

// Mock only the PCO HTTP layer — token + fetch helpers. Everything else
// (auth, permissions, the upsert mutation) runs for real inside convexTest.
vi.mock("../../lib/pcoServicesApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/pcoServicesApi")>();
  return {
    ...actual,
    getValidAccessToken: vi.fn().mockResolvedValue("mock-access-token"),
    fetchAllSongs: vi.fn().mockResolvedValue([]),
    fetchSongArrangements: vi.fn().mockResolvedValue([]),
  };
});

import {
  fetchAllSongs,
  fetchSongArrangements,
} from "../../lib/pcoServicesApi";

let activeHandle: ReturnType<typeof convexTest> | null = null;

afterEach(async () => {
  if (activeHandle) {
    await activeHandle.finishInProgressScheduledFunctions();
    activeHandle = null;
  }
  vi.clearAllMocks();
});

async function setupSchedulingWorld() {
  const t = convexTest(schema, modules);
  activeHandle = t;
  const world = await buildSchedulingWorld(t);
  return { t, world };
}

// ============================================================================
// Fixture helpers
// ============================================================================

function pcoSong(
  id: string,
  title: string,
  attributes?: Partial<PcoSong["attributes"]>,
): PcoSong {
  return {
    id,
    type: "Song",
    attributes: {
      title,
      ccli_number: null,
      author: null,
      ...attributes,
    },
  };
}

function pcoArrangement(
  id: string,
  attributes?: Partial<PcoArrangement["attributes"]>,
): PcoArrangement {
  return {
    id,
    type: "Arrangement",
    attributes: {
      name: "Default Arrangement",
      bpm: null,
      length: null,
      meter: null,
      chord_chart_key: null,
      ...attributes,
    },
  };
}

// ============================================================================
// mapPcoSongs (pure transform)
// ============================================================================

describe("mapPcoSongs", () => {
  it("merges song attributes with the first arrangement", () => {
    const songs = [
      pcoSong("s1", "Goodness of God", {
        author: "Jenn Johnson",
        ccli_number: "7117726",
      }),
    ];
    const arrangements = new Map([
      [
        "s1",
        [
          pcoArrangement("a1", {
            name: "Standard",
            bpm: 126,
            meter: "4/4",
            chord_chart_key: "Ab",
          }),
        ],
      ],
    ]);

    expect(mapPcoSongs(songs, arrangements)).toEqual([
      {
        title: "Goodness of God",
        author: "Jenn Johnson",
        ccliNumber: "7117726",
        defaultKey: "Ab",
        bpm: 126,
        meter: "4/4",
        arrangementName: "Standard",
      },
    ]);
  });

  it("uses the FIRST arrangement when a song has several", () => {
    const songs = [pcoSong("s1", "Way Maker")];
    const arrangements = new Map([
      [
        "s1",
        [
          pcoArrangement("a1", { name: "Live", chord_chart_key: "E", bpm: 68 }),
          pcoArrangement("a2", { name: "Acoustic", chord_chart_key: "D", bpm: 60 }),
        ],
      ],
    ]);

    const [row] = mapPcoSongs(songs, arrangements);
    expect(row.defaultKey).toBe("E");
    expect(row.bpm).toBe(68);
    expect(row.arrangementName).toBe("Live");
  });

  it("skips songs with blank or whitespace-only titles", () => {
    const songs = [
      pcoSong("s1", ""),
      pcoSong("s2", "   "),
      pcoSong("s3", "Real Song"),
    ];

    const rows = mapPcoSongs(songs, new Map());
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Real Song");
  });

  it("omits fields that are null or missing", () => {
    const songs = [pcoSong("s1", "Bare Song")];

    // No arrangements at all; author/ccli are null.
    expect(mapPcoSongs(songs, new Map())).toEqual([{ title: "Bare Song" }]);
  });
});

// ============================================================================
// upsertImportedSongs (internalMutation)
// ============================================================================

describe("upsertImportedSongs", () => {
  it("inserts new songs with the importing user as creator", async () => {
    const { t, world } = await setupSchedulingWorld();

    const counts = await t.mutation(
      internal.functions.pcoServices.songImport.upsertImportedSongs,
      {
        communityId: world.communityId,
        userId: world.groupLeaderId,
        songs: [
          {
            title: "Goodness of God",
            author: "Jenn Johnson",
            ccliNumber: "7117726",
            defaultKey: "Ab",
            bpm: 126,
            meter: "4/4",
            arrangementName: "Standard",
          },
          { title: "Way Maker" },
        ],
      },
    );

    expect(counts).toEqual({ imported: 2, updated: 0, skipped: 0 });

    const songs = await t.run(async (ctx) =>
      ctx.db
        .query("songs")
        .withIndex("by_community", (q) => q.eq("communityId", world.communityId))
        .collect(),
    );
    expect(songs).toHaveLength(2);
    const goodness = songs.find((s) => s.title === "Goodness of God");
    expect(goodness?.ccliNumber).toBe("7117726");
    expect(goodness?.defaultKey).toBe("Ab");
    expect(goodness?.bpm).toBe(126);
    expect(goodness?.createdById).toBe(world.groupLeaderId);
    expect(typeof goodness?.createdAt).toBe("number");
  });

  it("matches by ccli number and fills ONLY missing fields", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.communityAdminId)).accessToken;

    // Existing song with a user-set bpm; no author/key yet.
    const songId = await t.mutation(api.functions.scheduling.songs.createSong, {
      token,
      communityId: world.communityId,
      input: { title: "Goodness of God", ccliNumber: "7117726", bpm: 120 },
    });

    const counts = await t.mutation(
      internal.functions.pcoServices.songImport.upsertImportedSongs,
      {
        communityId: world.communityId,
        userId: world.groupLeaderId,
        songs: [
          {
            // Different title casing — ccli is the match key.
            title: "GOODNESS OF GOD",
            author: "Jenn Johnson",
            ccliNumber: "7117726",
            defaultKey: "Ab",
            bpm: 126,
          },
        ],
      },
    );

    expect(counts).toEqual({ imported: 0, updated: 1, skipped: 0 });

    const song = await t.run(async (ctx) => ctx.db.get(songId));
    // User's edits are never clobbered.
    expect(song?.bpm).toBe(120);
    expect(song?.title).toBe("Goodness of God");
    // Missing fields are filled.
    expect(song?.author).toBe("Jenn Johnson");
    expect(song?.defaultKey).toBe("Ab");
  });

  it("counts a ccli match with nothing to fill as skipped", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.communityAdminId)).accessToken;

    await t.mutation(api.functions.scheduling.songs.createSong, {
      token,
      communityId: world.communityId,
      input: {
        title: "Way Maker",
        ccliNumber: "7115744",
        author: "Sinach",
        defaultKey: "E",
        bpm: 68,
        meter: "4/4",
        arrangementName: "Live",
      },
    });

    const counts = await t.mutation(
      internal.functions.pcoServices.songImport.upsertImportedSongs,
      {
        communityId: world.communityId,
        userId: world.groupLeaderId,
        songs: [
          {
            title: "Way Maker",
            ccliNumber: "7115744",
            author: "Different Author",
            defaultKey: "D",
          },
        ],
      },
    );

    expect(counts).toEqual({ imported: 0, updated: 0, skipped: 1 });
  });

  it("matches rows without a ccli number by case-insensitive title", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.communityAdminId)).accessToken;

    const songId = await t.mutation(api.functions.scheduling.songs.createSong, {
      token,
      communityId: world.communityId,
      input: { title: "Way Maker" },
    });

    const counts = await t.mutation(
      internal.functions.pcoServices.songImport.upsertImportedSongs,
      {
        communityId: world.communityId,
        userId: world.groupLeaderId,
        songs: [{ title: "WAY MAKER", defaultKey: "E", bpm: 68 }],
      },
    );

    expect(counts).toEqual({ imported: 0, updated: 1, skipped: 0 });
    const song = await t.run(async (ctx) => ctx.db.get(songId));
    expect(song?.defaultKey).toBe("E");
    expect(song?.bpm).toBe(68);

    const all = await t.run(async (ctx) =>
      ctx.db
        .query("songs")
        .withIndex("by_community", (q) => q.eq("communityId", world.communityId))
        .collect(),
    );
    expect(all).toHaveLength(1);
  });

  it("inserts a row whose ccli matches nothing (ccli rows do not fall back to title)", async () => {
    // Per the import spec: rows carrying a ccli number match by ccli only.
    // A same-title song without that ccli is treated as a different song.
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.communityAdminId)).accessToken;

    await t.mutation(api.functions.scheduling.songs.createSong, {
      token,
      communityId: world.communityId,
      input: { title: "Way Maker" },
    });

    const counts = await t.mutation(
      internal.functions.pcoServices.songImport.upsertImportedSongs,
      {
        communityId: world.communityId,
        userId: world.groupLeaderId,
        songs: [{ title: "Way Maker", ccliNumber: "7115744" }],
      },
    );

    expect(counts).toEqual({ imported: 1, updated: 0, skipped: 0 });
  });

  it("dedupes repeated rows within a single import batch", async () => {
    const { t, world } = await setupSchedulingWorld();

    const counts = await t.mutation(
      internal.functions.pcoServices.songImport.upsertImportedSongs,
      {
        communityId: world.communityId,
        userId: world.groupLeaderId,
        songs: [
          { title: "Amazing Grace", ccliNumber: "22025", bpm: 72 },
          { title: "Amazing Grace", ccliNumber: "22025", author: "John Newton" },
        ],
      },
    );

    // First row inserts; second matches it and fills the missing author.
    expect(counts).toEqual({ imported: 1, updated: 1, skipped: 0 });

    const all = await t.run(async (ctx) =>
      ctx.db
        .query("songs")
        .withIndex("by_community", (q) => q.eq("communityId", world.communityId))
        .collect(),
    );
    expect(all).toHaveLength(1);
    expect(all[0].bpm).toBe(72);
    expect(all[0].author).toBe("John Newton");
  });
});

// ============================================================================
// importSongsFromPco (action)
// ============================================================================

async function connectPco(t: ReturnType<typeof convexTest>, communityId: any) {
  await t.run(async (ctx) => {
    await ctx.db.insert("communityIntegrations", {
      communityId,
      integrationType: "planning_center",
      credentials: { access_token: "x" },
      config: {},
      status: "connected",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
}

describe("importSongsFromPco", () => {
  it("imports the PCO library end-to-end and returns counts", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;
    await connectPco(t, world.communityId);

    (fetchAllSongs as any).mockResolvedValue([
      pcoSong("s1", "Goodness of God", {
        author: "Jenn Johnson",
        ccli_number: "7117726",
      }),
      pcoSong("s2", "Way Maker"),
    ]);
    (fetchSongArrangements as any).mockImplementation(
      async (_token: string, songId: string) =>
        songId === "s1"
          ? [
              pcoArrangement("a1", {
                name: "Standard",
                bpm: 126,
                meter: "4/4",
                chord_chart_key: "Ab",
              }),
            ]
          : [],
    );

    const result = await t.action(
      api.functions.pcoServices.songImport.importSongsFromPco,
      { token, communityId: world.communityId },
    );

    expect(result).toEqual({ imported: 2, updated: 0, skipped: 0, total: 2 });

    const songs = await t.run(async (ctx) =>
      ctx.db
        .query("songs")
        .withIndex("by_community", (q) => q.eq("communityId", world.communityId))
        .collect(),
    );
    expect(songs).toHaveLength(2);
    const goodness = songs.find((s) => s.title === "Goodness of God");
    expect(goodness?.defaultKey).toBe("Ab");
    expect(goodness?.bpm).toBe(126);
    expect(goodness?.arrangementName).toBe("Standard");
    expect(goodness?.createdById).toBe(world.groupLeaderId);
  });

  it("rejects when Planning Center is not connected", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;

    await expect(
      t.action(api.functions.pcoServices.songImport.importSongsFromPco, {
        token,
        communityId: world.communityId,
      }),
    ).rejects.toThrow("Planning Center is not connected");
  });

  it("rejects callers who may not manage the song library", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.channelMemberId)).accessToken;
    await connectPco(t, world.communityId);

    await expect(
      t.action(api.functions.pcoServices.songImport.importSongsFromPco, {
        token,
        communityId: world.communityId,
      }),
    ).rejects.toThrow(/group leader or community admin/);
  });
});
