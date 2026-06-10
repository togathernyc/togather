/**
 * Tests for the native song library — `songs` CRUD, search, chart attach/remove,
 * the deleteSong → null-out-referencing-`eventItems` cascade, and the
 * `eventItems` ⇄ song integration (updateItem sets/clears `songId`,
 * listItems/getEvent join `item.song`). Permissions reuse existing guards
 * (community admin for edits, community membership for reads). (ADR-027)
 */

import { describe, it, expect, afterEach } from "vitest";
import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { generateTokens } from "../../lib/auth";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { buildSchedulingWorld } from "./fixtures";

let activeHandle: ReturnType<typeof convexTest> | null = null;

afterEach(async () => {
  if (activeHandle) {
    await activeHandle.finishInProgressScheduledFunctions();
    activeHandle = null;
  }
});

async function setupSchedulingWorld() {
  const t = convexTest(schema, modules);
  activeHandle = t;
  const world = await buildSchedulingWorld(t);
  return { t, world };
}

const DAY = 86400000;

/** Create a draft event plan and return its id. */
async function createPlan(
  t: ReturnType<typeof convexTest>,
  token: string,
  groupId: Id<"groups">,
): Promise<Id<"eventPlans">> {
  const eventDate = Date.now() + 7 * DAY;
  const { planId } = await t.mutation(
    api.functions.scheduling.events.createEvent,
    {
      token,
      groupId,
      title: "Sunday",
      eventDate,
      times: [{ label: "10 AM", startsAt: eventDate }],
    },
  );
  return planId;
}

describe("songs CRUD", () => {
  it("creates a song and reads it back", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.communityAdminId)).accessToken;

    const songId = await t.mutation(api.functions.scheduling.songs.createSong, {
      token,
      communityId: world.communityId,
      input: {
        title: "Amazing Grace",
        author: "John Newton",
        ccliNumber: "22025",
        defaultKey: "G",
        bpm: 72,
        meter: "3/4",
        arrangementName: "Standard",
        structure: ["Verse 1", "Chorus"],
        multitracksUrl: "https://multitracks.com/x",
        notes: "Capo 3",
      },
    });

    const song = await t.query(api.functions.scheduling.songs.getSong, {
      token,
      songId,
    });
    expect(song?.title).toBe("Amazing Grace");
    expect(song?.author).toBe("John Newton");
    expect(song?.ccliNumber).toBe("22025");
    expect(song?.defaultKey).toBe("G");
    expect(song?.bpm).toBe(72);
    expect(song?.structure).toEqual(["Verse 1", "Chorus"]);
    expect(song?.charts).toEqual([]);
    expect(typeof song?.createdAt).toBe("number");
    expect(song?.createdById).toBe(world.communityAdminId);
  });

  it("lists songs sorted by title (case-insensitive)", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.communityAdminId)).accessToken;

    for (const title of ["zebra", "Apple", "mango"]) {
      await t.mutation(api.functions.scheduling.songs.createSong, {
        token,
        communityId: world.communityId,
        input: { title },
      });
    }

    const songs = await t.query(api.functions.scheduling.songs.listSongs, {
      token,
      communityId: world.communityId,
    });
    expect(songs.map((s) => s.title)).toEqual(["Apple", "mango", "zebra"]);
  });

  it("filters by title or ccliNumber via search (case-insensitive)", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.communityAdminId)).accessToken;

    await t.mutation(api.functions.scheduling.songs.createSong, {
      token,
      communityId: world.communityId,
      input: { title: "Build My Life", ccliNumber: "7070345" },
    });
    await t.mutation(api.functions.scheduling.songs.createSong, {
      token,
      communityId: world.communityId,
      input: { title: "Goodness of God", ccliNumber: "7117726" },
    });

    const byTitle = await t.query(api.functions.scheduling.songs.listSongs, {
      token,
      communityId: world.communityId,
      search: "build",
    });
    expect(byTitle.map((s) => s.title)).toEqual(["Build My Life"]);

    const byCcli = await t.query(api.functions.scheduling.songs.listSongs, {
      token,
      communityId: world.communityId,
      search: "7117726",
    });
    expect(byCcli.map((s) => s.title)).toEqual(["Goodness of God"]);
  });

  it("updates a song's fields and bumps updatedAt", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.communityAdminId)).accessToken;

    const songId = await t.mutation(api.functions.scheduling.songs.createSong, {
      token,
      communityId: world.communityId,
      input: { title: "Old Title", defaultKey: "C" },
    });
    const before = await t.query(api.functions.scheduling.songs.getSong, {
      token,
      songId,
    });

    await t.mutation(api.functions.scheduling.songs.updateSong, {
      token,
      songId,
      patch: { title: "New Title", defaultKey: "D" },
    });

    const after = await t.query(api.functions.scheduling.songs.getSong, {
      token,
      songId,
    });
    expect(after?.title).toBe("New Title");
    expect(after?.defaultKey).toBe("D");
    expect(after!.updatedAt).toBeGreaterThanOrEqual(before!.updatedAt);
  });

  it("deletes a song", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.communityAdminId)).accessToken;

    const songId = await t.mutation(api.functions.scheduling.songs.createSong, {
      token,
      communityId: world.communityId,
      input: { title: "Temp" },
    });
    await t.mutation(api.functions.scheduling.songs.deleteSong, {
      token,
      songId,
    });

    const song = await t.query(api.functions.scheduling.songs.getSong, {
      token,
      songId,
    });
    expect(song).toBeNull();
  });

  it("rejects an empty title on create", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.communityAdminId)).accessToken;
    await expect(
      t.mutation(api.functions.scheduling.songs.createSong, {
        token,
        communityId: world.communityId,
        input: { title: "   " },
      }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("song charts", () => {
  it("attaches and removes charts, resolving a url for each", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.communityAdminId)).accessToken;

    const songId = await t.mutation(api.functions.scheduling.songs.createSong, {
      token,
      communityId: world.communityId,
      input: { title: "Charted" },
    });

    await t.mutation(api.functions.scheduling.songs.attachChart, {
      token,
      songId,
      chart: {
        key: "G",
        label: "Lead Sheet (G)",
        fileKey: "https://example.com/chart-g.pdf",
        mimeType: "application/pdf",
      },
    });
    await t.mutation(api.functions.scheduling.songs.attachChart, {
      token,
      songId,
      chart: {
        key: "A",
        label: "Lead Sheet (A)",
        fileKey: "https://example.com/chart-a.pdf",
        mimeType: "application/pdf",
      },
    });

    let song = await t.query(api.functions.scheduling.songs.getSong, {
      token,
      songId,
    });
    expect(song?.charts.map((c) => c.label)).toEqual([
      "Lead Sheet (G)",
      "Lead Sheet (A)",
    ]);
    // Each chart carries a resolved url alongside its stored fileKey.
    expect(song?.charts[0].url).toBe("https://example.com/chart-g.pdf");

    await t.mutation(api.functions.scheduling.songs.removeChart, {
      token,
      songId,
      fileKey: "https://example.com/chart-g.pdf",
    });

    song = await t.query(api.functions.scheduling.songs.getSong, {
      token,
      songId,
    });
    expect(song?.charts.map((c) => c.label)).toEqual(["Lead Sheet (A)"]);
  });
});

describe("songs permissions", () => {
  it("lets a community member list/get but not edit", async () => {
    const { t, world } = await setupSchedulingWorld();
    const adminToken = (await generateTokens(world.communityAdminId)).accessToken;
    const songId = await t.mutation(api.functions.scheduling.songs.createSong, {
      token: adminToken,
      communityId: world.communityId,
      input: { title: "Members can read" },
    });

    // A plain group member is an active community member.
    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;
    const songs = await t.query(api.functions.scheduling.songs.listSongs, {
      token: memberToken,
      communityId: world.communityId,
    });
    expect(songs.length).toBe(1);

    await expect(
      t.mutation(api.functions.scheduling.songs.createSong, {
        token: memberToken,
        communityId: world.communityId,
        input: { title: "Sneaky" },
      }),
    ).rejects.toThrow(ConvexError);
    await expect(
      t.mutation(api.functions.scheduling.songs.updateSong, {
        token: memberToken,
        songId,
        patch: { title: "Hijacked" },
      }),
    ).rejects.toThrow(ConvexError);
    await expect(
      t.mutation(api.functions.scheduling.songs.deleteSong, {
        token: memberToken,
        songId,
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("forbids an outsider from listing the library", async () => {
    const { t, world } = await setupSchedulingWorld();
    const outsiderToken = (await generateTokens(world.outsiderId)).accessToken;
    await expect(
      t.query(api.functions.scheduling.songs.listSongs, {
        token: outsiderToken,
        communityId: world.communityId,
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("lets a group leader (not a community admin) manage the library", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    const songId = await t.mutation(api.functions.scheduling.songs.createSong, {
      token: leaderToken,
      communityId: world.communityId,
      input: { title: "Leader's pick" },
    });
    expect(songId).toBeTruthy();
    await t.mutation(api.functions.scheduling.songs.updateSong, {
      token: leaderToken,
      songId,
      patch: { defaultKey: "A" },
    });
    await t.mutation(api.functions.scheduling.songs.deleteSong, {
      token: leaderToken,
      songId,
    });
  });

  it("does not grant edit rights from a leader role on an archived group", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    // Archive the only group the user leads; their membership is retained.
    await t.run(async (ctx) => {
      await ctx.db.patch(world.groupId, {
        isArchived: true,
        archivedAt: Date.now(),
      });
    });

    expect(
      await t.query(api.functions.scheduling.songs.canManageSongs, {
        token: leaderToken,
        communityId: world.communityId,
      }),
    ).toBe(false);
    await expect(
      t.mutation(api.functions.scheduling.songs.createSong, {
        token: leaderToken,
        communityId: world.communityId,
        input: { title: "From an archived group" },
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("canManageSongs reflects admin/leader vs plain member", async () => {
    const { t, world } = await setupSchedulingWorld();
    const adminToken = (await generateTokens(world.communityAdminId)).accessToken;
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;
    const outsiderToken = (await generateTokens(world.outsiderId)).accessToken;

    const call = (token: string) =>
      t.query(api.functions.scheduling.songs.canManageSongs, {
        token,
        communityId: world.communityId,
      });

    expect(await call(adminToken)).toBe(true);
    expect(await call(leaderToken)).toBe(true);
    expect(await call(memberToken)).toBe(false);
    expect(await call(outsiderToken)).toBe(false);
  });
});

describe("eventItems ⇄ song integration", () => {
  it("updateItem sets and clears songId, and listItems joins the song", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;
    const adminToken = (await generateTokens(world.communityAdminId)).accessToken;
    const planId = await createPlan(t, token, world.groupId);

    const songId = await t.mutation(api.functions.scheduling.songs.createSong, {
      token: adminToken,
      communityId: world.communityId,
      input: { title: "Opener Song", defaultKey: "E" },
    });

    const { itemId } = await t.mutation(
      api.functions.scheduling.eventItems.createItem,
      { token, planId, type: "song", title: "Opener" },
    );

    // No song yet.
    let items = await t.query(api.functions.scheduling.eventItems.listItems, {
      token,
      planId,
    });
    expect(items?.[0].song ?? null).toBeNull();

    // Link the song.
    await t.mutation(api.functions.scheduling.eventItems.updateItem, {
      token,
      itemId,
      songId,
    });
    items = await t.query(api.functions.scheduling.eventItems.listItems, {
      token,
      planId,
    });
    expect(items?.[0].songId).toBe(songId);
    expect(items?.[0].song?.title).toBe("Opener Song");
    expect(items?.[0].song?.defaultKey).toBe("E");

    // getEvent also joins the song onto its items.
    const event = await t.query(api.functions.scheduling.events.getEvent, {
      token,
      planId,
    });
    expect(event?.items?.[0].song?.title).toBe("Opener Song");

    // Clear the link with null.
    await t.mutation(api.functions.scheduling.eventItems.updateItem, {
      token,
      itemId,
      songId: null,
    });
    items = await t.query(api.functions.scheduling.eventItems.listItems, {
      token,
      planId,
    });
    expect(items?.[0].songId ?? null).toBeNull();
    expect(items?.[0].song ?? null).toBeNull();
  });

  it("deleteSong nulls out songId on referencing eventItems", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;
    const adminToken = (await generateTokens(world.communityAdminId)).accessToken;
    const planId = await createPlan(t, token, world.groupId);

    const songId = await t.mutation(api.functions.scheduling.songs.createSong, {
      token: adminToken,
      communityId: world.communityId,
      input: { title: "Doomed" },
    });
    const { itemId } = await t.mutation(
      api.functions.scheduling.eventItems.createItem,
      { token, planId, type: "song", title: "Row" },
    );
    await t.mutation(api.functions.scheduling.eventItems.updateItem, {
      token,
      itemId,
      songId,
    });

    await t.mutation(api.functions.scheduling.songs.deleteSong, {
      token: adminToken,
      songId,
    });

    const items = await t.query(api.functions.scheduling.eventItems.listItems, {
      token,
      planId,
    });
    // The item survives, falling back to its free-typed row; the link is gone.
    expect(items?.length).toBe(1);
    expect(items?.[0].songId ?? null).toBeNull();
    expect(items?.[0].song ?? null).toBeNull();
  });

  it("linking a song reuses requirePlanScheduler (member cannot link)", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const adminToken = (await generateTokens(world.communityAdminId)).accessToken;
    const planId = await createPlan(t, leaderToken, world.groupId);

    const songId = await t.mutation(api.functions.scheduling.songs.createSong, {
      token: adminToken,
      communityId: world.communityId,
      input: { title: "Locked" },
    });
    const { itemId } = await t.mutation(
      api.functions.scheduling.eventItems.createItem,
      { token: leaderToken, planId, type: "song", title: "Row" },
    );

    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;
    await expect(
      t.mutation(api.functions.scheduling.eventItems.updateItem, {
        token: memberToken,
        itemId,
        songId,
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("duplicateItem preserves the song link", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const adminToken = (await generateTokens(world.communityAdminId)).accessToken;
    const planId = await createPlan(t, leaderToken, world.groupId);

    const songId = await t.mutation(api.functions.scheduling.songs.createSong, {
      token: adminToken,
      communityId: world.communityId,
      input: { title: "Build My Life", defaultKey: "G" },
    });
    const { itemId } = await t.mutation(
      api.functions.scheduling.eventItems.createItem,
      { token: leaderToken, planId, type: "song", title: "Opener" },
    );
    await t.mutation(api.functions.scheduling.eventItems.updateItem, {
      token: leaderToken,
      itemId,
      songId,
    });

    const { itemId: copyId } = await t.mutation(
      api.functions.scheduling.eventItems.duplicateItem,
      { token: leaderToken, itemId },
    );

    const items = await t.query(api.functions.scheduling.eventItems.listItems, {
      token: leaderToken,
      planId,
    });
    const copy = items?.find((i) => i._id === copyId);
    expect(copy?.songId).toBe(songId);
    expect(copy?.song?.title).toBe("Build My Life");
  });

  it("duplicateEvent preserves song links on copied items", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const adminToken = (await generateTokens(world.communityAdminId)).accessToken;
    const planId = await createPlan(t, leaderToken, world.groupId);

    const songId = await t.mutation(api.functions.scheduling.songs.createSong, {
      token: adminToken,
      communityId: world.communityId,
      input: { title: "Great Are You Lord" },
    });
    const { itemId } = await t.mutation(
      api.functions.scheduling.eventItems.createItem,
      { token: leaderToken, planId, type: "song", title: "Worship 1" },
    );
    await t.mutation(api.functions.scheduling.eventItems.updateItem, {
      token: leaderToken,
      itemId,
      songId,
    });

    const { planId: newPlanId } = await t.mutation(
      api.functions.scheduling.events.duplicateEvent,
      { token: leaderToken, planId },
    );

    const items = await t.query(api.functions.scheduling.eventItems.listItems, {
      token: leaderToken,
      planId: newPlanId,
    });
    expect(items?.[0]?.songId).toBe(songId);
    expect(items?.[0]?.song?.title).toBe("Great Are You Lord");
  });
});
