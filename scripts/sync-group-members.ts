#!/usr/bin/env npx ts-node
/**
 * Targeted Group Members Sync Script
 *
 * Syncs just group members from Supabase to Convex.
 * Run with: infisical run --env=staging -- npx ts-node scripts/sync-group-members.ts
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import pg from "pg";

const { Pool } = pg;

// Helper to convert timestamps
function toTimestamp(date: Date | string | null): number | undefined {
  if (!date) return undefined;
  const d = typeof date === "string" ? new Date(date) : date;
  return d.getTime();
}

async function syncGroupMembers() {
  const databaseUrl = process.env.DATABASE_URL;
  let convexUrl = process.env.CONVEX_SITE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required");
  }
  if (!convexUrl) {
    throw new Error("CONVEX_SITE_URL environment variable is required");
  }

  // Convert .convex.site URLs to .convex.cloud for the HTTP client
  convexUrl = convexUrl.replace(".convex.site", ".convex.cloud");

  console.log("Connecting to Supabase...");
  const pool = new Pool({ connectionString: databaseUrl });

  console.log(`Connecting to Convex at ${convexUrl}...`);
  const convex = new ConvexHttpClient(convexUrl);

  try {
    // First, build ID maps from existing Convex data
    console.log("\n=== Building ID maps from Convex ===");

    // Get all groups from Convex to build legacy ID mapping
    const convexGroups = await convex.query(api.functions.groups.listAllForSync, {});
    const groupLegacyToConvex = new Map<string, string>();
    for (const g of convexGroups) {
      if (g.legacyId) {
        groupLegacyToConvex.set(g.legacyId, g._id);
      }
    }
    console.log(`  Found ${groupLegacyToConvex.size} groups with legacy IDs`);

    // Get all users from Convex to build legacy ID mapping (paginated)
    const userLegacyToConvex = new Map<string | number, string>();
    let userCursor: string | null = null;
    let userPage = 0;

    do {
      const result = await convex.query(api.functions.users.listAllForSync, {
        cursor: userCursor ?? undefined,
        limit: 1000,
      });

      for (const u of result.users) {
        if (u.legacyId) {
          userLegacyToConvex.set(u.legacyId, u._id);
          // Also map by numeric ID if it's a number string
          const numericId = parseInt(u.legacyId, 10);
          if (!isNaN(numericId)) {
            userLegacyToConvex.set(numericId, u._id);
          }
        }
      }

      userCursor = result.nextCursor;
      userPage++;
      console.log(`  Loaded page ${userPage}: ${result.users.length} users (total so far: ${userLegacyToConvex.size})`);
    } while (userCursor);

    console.log(`  Found ${userLegacyToConvex.size} users with legacy IDs`);

    // Sync group members
    console.log("\n=== Syncing group members ===");
    const { rows: groupMembers } = await pool.query("SELECT * FROM group_member");
    console.log(`Found ${groupMembers.length} group members in Supabase`);

    let synced = 0;
    let skipped = 0;
    let failed = 0;

    for (const gm of groupMembers) {
      const groupConvexId = groupLegacyToConvex.get(gm.group_id);
      const userConvexId = userLegacyToConvex.get(gm.user_id);

      if (!groupConvexId) {
        console.error(`  Skipping group member ${gm.id}: group ${gm.group_id} not found in Convex`);
        skipped++;
        continue;
      }
      if (!userConvexId) {
        console.error(`  Skipping group member ${gm.id}: user ${gm.user_id} not found in Convex`);
        skipped++;
        continue;
      }

      try {
        await convex.mutation(api.functions.groupMembers.upsertFromLegacy, {
          legacyId: String(gm.id),
          groupId: groupConvexId as any,
          userId: userConvexId as any,
          role: gm.role === "admin" ? "leader" : gm.role,
          joinedAt: toTimestamp(gm.joined_at)!,
          leftAt: toTimestamp(gm.left_at),
          notificationsEnabled: gm.notifications_enabled ?? undefined,
          requestStatus: gm.request_status ?? undefined,  // Convert null to undefined
          requestedAt: toTimestamp(gm.requested_at),
          requestReviewedAt: toTimestamp(gm.request_reviewed_at),
          requestReviewedByLegacyId: gm.request_reviewed_by_id ? String(gm.request_reviewed_by_id) : undefined,
        });
        synced++;
        if (synced % 100 === 0) {
          console.log(`  Synced ${synced} group members...`);
        }
      } catch (err: any) {
        console.error(`  Failed to sync group member ${gm.id}: ${err.message}`);
        failed++;
      }
    }

    console.log("\n=== Group Members Sync Complete ===");
    console.log(`  Synced: ${synced}`);
    console.log(`  Skipped: ${skipped}`);
    console.log(`  Failed: ${failed}`);

  } finally {
    await pool.end();
  }
}

// Run the sync
syncGroupMembers()
  .then(() => {
    console.log("\nSync completed successfully!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Sync failed:", err);
    process.exit(1);
  });
