/**
 * Tests for copying church-uploaded chart/audio FILES from PCO into songs'
 * `charts` (ADR-027 Phase 2, the song-file import follow-up).
 *
 * Covers:
 *  - `isChurchUploadedChart` — the licensing/type guardrail that decides which
 *    PCO arrangement attachments may be re-hosted (church-uploaded PDF → import;
 *    SongSelect/CCLI-licensed chart → skip; link/unsupported type → skip).
 *  - `importSongsFromPco` with `includeFiles` — the download → R2 → attach flow,
 *    with the PCO HTTP layer and the R2 put helper mocked. Asserts charts get
 *    attached, idempotent re-runs add nothing, and SongSelect attachments are
 *    skipped with correct counts.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { generateTokens } from "../../lib/auth";
import { api } from "../../_generated/api";
import { buildSchedulingWorld } from "../scheduling/fixtures";
import { isChurchUploadedChart } from "../../functions/pcoServices/songImport";
import type {
  PcoArrangement,
  PcoSong,
  PcoSongAttachment,
} from "../../lib/pcoServicesApi";

// Mock the PCO HTTP layer (token + fetchers + attachment download) and the
// server-side R2 put helper. Everything else (auth, permissions, the upsert &
// attach mutations) runs for real inside convexTest.
vi.mock("../../lib/pcoServicesApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/pcoServicesApi")>();
  return {
    ...actual,
    getValidAccessToken: vi.fn().mockResolvedValue("mock-access-token"),
    fetchAllSongs: vi.fn().mockResolvedValue([]),
    fetchSongArrangements: vi.fn().mockResolvedValue([]),
    fetchArrangementAttachments: vi.fn().mockResolvedValue([]),
    openAttachmentUrl: vi.fn().mockResolvedValue(null),
    downloadAttachmentBytes: vi
      .fn()
      .mockResolvedValue(new ArrayBuffer(8)),
  };
});

vi.mock("../../lib/r2", () => ({
  putR2Object: vi.fn(async (args: { fileName: string }) => ({
    key: `uploads/mock-${args.fileName}`,
    storagePath: `r2:uploads/mock-${args.fileName}`,
  })),
}));

import {
  fetchAllSongs,
  fetchSongArrangements,
  fetchArrangementAttachments,
  openAttachmentUrl,
  downloadAttachmentBytes,
} from "../../lib/pcoServicesApi";
import { putR2Object } from "../../lib/r2";

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
    attributes: { title, ccli_number: null, author: null, ...attributes },
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
      name: "Default",
      bpm: null,
      length: null,
      meter: null,
      chord_chart_key: null,
      ...attributes,
    },
  };
}

function attachment(
  id: string,
  attributes?: Partial<PcoSongAttachment["attributes"]>,
): PcoSongAttachment {
  return {
    id,
    type: "Attachment",
    attributes: {
      filename: "chart.pdf",
      url: "https://files.pco/chart.pdf",
      content_type: "application/pdf",
      linked_url: null,
      pco_type: "AttachmentTypes::S3",
      downloadable: true,
      licenses_purchased: null,
      licenses_used: null,
      licenses_remaining: null,
      ...attributes,
    },
  };
}

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

// ============================================================================
// isChurchUploadedChart (pure licensing/type guardrail)
// ============================================================================

describe("isChurchUploadedChart", () => {
  it("imports a plain church-uploaded PDF", () => {
    expect(isChurchUploadedChart(attachment("a"))).toBe(true);
  });

  it("imports a church-uploaded image and audio reference", () => {
    expect(
      isChurchUploadedChart(
        attachment("a", { filename: "chart.png", content_type: "image/png" }),
      ),
    ).toBe(true);
    expect(
      isChurchUploadedChart(
        attachment("a", { filename: "ref.mp3", content_type: "audio/mpeg" }),
      ),
    ).toBe(true);
  });

  it("skips SongSelect/CCLI-licensed charts (license tracking present)", () => {
    expect(
      isChurchUploadedChart(
        attachment("a", { licenses_purchased: 5, licenses_used: 1 }),
      ),
    ).toBe(false);
    // Or marked by pco_type even when license counts happen to be null.
    expect(
      isChurchUploadedChart(
        attachment("a", { pco_type: "AttachmentTypes::SongSelect" }),
      ),
    ).toBe(false);
  });

  it("skips linked files (Google Docs / remote links)", () => {
    expect(
      isChurchUploadedChart(
        attachment("a", {
          linked_url: "https://docs.google.com/x",
          pco_type: "AttachmentTypes::GoogleDrive",
          content_type: "application/pdf",
        }),
      ),
    ).toBe(false);
  });

  it("skips unsupported file types and non-downloadable files", () => {
    expect(
      isChurchUploadedChart(
        attachment("a", {
          filename: "clip.mp4",
          content_type: "video/mp4",
        }),
      ),
    ).toBe(false);
    expect(isChurchUploadedChart(attachment("a", { downloadable: false }))).toBe(
      false,
    );
  });
});

// ============================================================================
// importSongsFromPco — file import phase
// ============================================================================

describe("importSongsFromPco (includeFiles)", () => {
  function mockLibrary(attachments: PcoSongAttachment[]) {
    (fetchAllSongs as any).mockResolvedValue([
      pcoSong("s1", "Goodness of God", { ccli_number: "7117726" }),
    ]);
    (fetchSongArrangements as any).mockResolvedValue([
      pcoArrangement("arr1", { chord_chart_key: "Ab" }),
    ]);
    (fetchArrangementAttachments as any).mockResolvedValue(attachments);
  }

  it("downloads a church chart, stores it in R2, and attaches it", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;
    await connectPco(t, world.communityId);
    mockLibrary([attachment("a1", { filename: "leadsheet.pdf" })]);

    const result = await t.action(
      api.functions.pcoServices.songImport.importSongsFromPco,
      { token, communityId: world.communityId },
    );

    expect(result.imported).toBe(1);
    expect(result.filesImported).toBe(1);
    expect(result.filesSkipped).toBe(0);
    expect(putR2Object).toHaveBeenCalledTimes(1);
    expect(downloadAttachmentBytes).toHaveBeenCalledTimes(1);

    const songs = await t.run(async (ctx) =>
      ctx.db
        .query("songs")
        .withIndex("by_community", (q) => q.eq("communityId", world.communityId))
        .collect(),
    );
    const charts = songs[0].charts ?? [];
    expect(charts).toHaveLength(1);
    expect(charts[0].label).toBe("leadsheet.pdf (Ab)");
    expect(charts[0].key).toBe("Ab");
    expect(charts[0].fileKey).toBe("r2:uploads/mock-leadsheet.pdf");
    expect(charts[0].mimeType).toBe("application/pdf");
  });

  it("skips SongSelect attachments and counts them", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;
    await connectPco(t, world.communityId);
    mockLibrary([
      attachment("a1", { filename: "church.pdf" }),
      attachment("a2", {
        filename: "songselect.pdf",
        licenses_purchased: 10,
        pco_type: "AttachmentTypes::SongSelect",
      }),
    ]);

    const result = await t.action(
      api.functions.pcoServices.songImport.importSongsFromPco,
      { token, communityId: world.communityId },
    );

    expect(result.filesImported).toBe(1);
    expect(result.filesSkipped).toBe(1);
    // Only the church file was downloaded/stored.
    expect(putR2Object).toHaveBeenCalledTimes(1);

    const songs = await t.run(async (ctx) =>
      ctx.db
        .query("songs")
        .withIndex("by_community", (q) => q.eq("communityId", world.communityId))
        .collect(),
    );
    expect((songs[0].charts ?? []).map((c) => c.label)).toEqual([
      "church.pdf (Ab)",
    ]);
  });

  it("is idempotent: a re-run adds no new charts and no PCO downloads", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;
    await connectPco(t, world.communityId);
    mockLibrary([attachment("a1", { filename: "leadsheet.pdf" })]);

    await t.action(api.functions.pcoServices.songImport.importSongsFromPco, {
      token,
      communityId: world.communityId,
    });
    vi.clearAllMocks();
    // Re-establish the library mocks cleared above.
    mockLibrary([attachment("a1", { filename: "leadsheet.pdf" })]);

    const second = await t.action(
      api.functions.pcoServices.songImport.importSongsFromPco,
      { token, communityId: world.communityId },
    );

    expect(second.filesImported).toBe(0);
    // Already-present label → we don't even download the file again.
    expect(downloadAttachmentBytes).not.toHaveBeenCalled();
    expect(putR2Object).not.toHaveBeenCalled();

    const songs = await t.run(async (ctx) =>
      ctx.db
        .query("songs")
        .withIndex("by_community", (q) => q.eq("communityId", world.communityId))
        .collect(),
    );
    expect(songs[0].charts ?? []).toHaveLength(1);
  });

  it("resolves the download URL via the open action when url is empty", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;
    await connectPco(t, world.communityId);
    mockLibrary([attachment("a1", { filename: "leadsheet.pdf", url: null })]);
    (openAttachmentUrl as any).mockResolvedValue("https://signed.pco/leadsheet.pdf");

    const result = await t.action(
      api.functions.pcoServices.songImport.importSongsFromPco,
      { token, communityId: world.communityId },
    );

    expect(openAttachmentUrl).toHaveBeenCalledWith(
      "mock-access-token",
      "s1",
      "arr1",
      "a1",
    );
    expect(result.filesImported).toBe(1);
  });

  it("does not fetch attachments when includeFiles is false", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;
    await connectPco(t, world.communityId);
    mockLibrary([attachment("a1")]);

    const result = await t.action(
      api.functions.pcoServices.songImport.importSongsFromPco,
      { token, communityId: world.communityId, includeFiles: false },
    );

    expect(result.imported).toBe(1);
    expect(result.filesImported).toBe(0);
    expect(result.filesSkipped).toBe(0);
    expect(fetchArrangementAttachments).not.toHaveBeenCalled();
  });
});
