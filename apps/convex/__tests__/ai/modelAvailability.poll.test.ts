/**
 * Poll-state mutation tests for the Claude model availability gate.
 *
 * Locks in the multi-thread notify behavior:
 *   - `beginPoll` starts the loop exactly once and records each affected thread
 *     at most once (so every thread gets one outage notice, none get spammed).
 *   - `resolveRecovery` hands back every affected thread once and is idempotent,
 *     so whichever path detects recovery (a gate retry or the hourly poll)
 *     announces "back online" to all of them and the other becomes a no-op.
 *
 * Exercises the real mutations through convex-test — no network/probe involved.
 *
 * Run with: cd apps/convex && pnpm test modelAvailability.poll
 */

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";
import { modules } from "../../test.setup";
import type { Id } from "../../_generated/dataModel";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

async function seedGroup(
  t: ReturnType<typeof convexTest>,
  slug: string,
): Promise<Id<"groups">> {
  const now = Date.now();
  return await t.run(async (ctx) => {
    const communityId = await ctx.db.insert("communities", {
      name: "Test Community",
      slug,
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });
    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "General",
      slug: "general",
      isActive: true,
      displayOrder: 0,
      createdAt: now,
    });
    return await ctx.db.insert("groups", {
      communityId,
      name: "Test Group",
      groupTypeId,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    });
  });
}

describe("claude model availability poll state", () => {
  test("beginPoll starts the loop once and dedupes notify targets per thread", async () => {
    const t = convexTest(schema, modules);
    const g1 = await seedGroup(t, "claude-poll-g1");
    const g2 = await seedGroup(t, "claude-poll-g2");

    // First thread to trip the gate: starts the loop and is recorded.
    const first = await t.mutation(
      internal.functions.ai.modelAvailability.beginPoll,
      { notifyGroupId: g1 },
    );
    expect(first).toEqual({ started: true, targetAdded: true });

    // Same thread trips again during the same outage: no restart, no re-notify.
    const again = await t.mutation(
      internal.functions.ai.modelAvailability.beginPoll,
      { notifyGroupId: g1 },
    );
    expect(again).toEqual({ started: false, targetAdded: false });

    // A different thread during the same outage: added (gets its own notice),
    // but the loop is not restarted.
    const second = await t.mutation(
      internal.functions.ai.modelAvailability.beginPoll,
      { notifyGroupId: g2 },
    );
    expect(second).toEqual({ started: false, targetAdded: true });

    const poll = await t.query(
      internal.functions.ai.modelAvailability.getPoll,
      {},
    );
    expect(poll?.active).toBe(true);
    expect(poll?.notifyTargets?.map((x) => x.groupId)).toEqual([g1, g2]);
  });

  test("resolveRecovery clears the loop and returns every affected thread once", async () => {
    const t = convexTest(schema, modules);
    const g1 = await seedGroup(t, "claude-rec-g1");
    const g2 = await seedGroup(t, "claude-rec-g2");
    await t.mutation(internal.functions.ai.modelAvailability.beginPoll, {
      notifyGroupId: g1,
    });
    await t.mutation(internal.functions.ai.modelAvailability.beginPoll, {
      notifyGroupId: g2,
    });

    const recovery = await t.mutation(
      internal.functions.ai.modelAvailability.resolveRecovery,
      { lastAvailableModel: "claude-opus-4-8" },
    );
    expect(recovery.wasActive).toBe(true);
    expect(recovery.targets.map((x) => x.groupId)).toEqual([g1, g2]);

    const poll = await t.query(
      internal.functions.ai.modelAvailability.getPoll,
      {},
    );
    expect(poll?.active).toBe(false);
    expect(poll?.notifyTargets).toEqual([]);
    expect(poll?.lastAvailableModel).toBe("claude-opus-4-8");

    // A second recovery (e.g. the scheduled poll firing after a gate retry
    // already recovered) is a no-op — no duplicate back-online notices.
    const again = await t.mutation(
      internal.functions.ai.modelAvailability.resolveRecovery,
      { lastAvailableModel: "claude-opus-4-8" },
    );
    expect(again).toEqual({ wasActive: false, targets: [] });
  });

  test("beginPoll with no thread target still starts the loop", async () => {
    const t = convexTest(schema, modules);
    const first = await t.mutation(
      internal.functions.ai.modelAvailability.beginPoll,
      {},
    );
    expect(first).toEqual({ started: true, targetAdded: false });
    const poll = await t.query(
      internal.functions.ai.modelAvailability.getPoll,
      {},
    );
    expect(poll?.active).toBe(true);
    expect(poll?.notifyTargets).toEqual([]);
  });
});
