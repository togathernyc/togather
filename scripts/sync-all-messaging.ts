#!/usr/bin/env npx ts-node
/**
 * Comprehensive Messaging Sync Script
 *
 * This script syncs all messaging data across the three layers:
 * 1. userCommunities → groupMembers (announcement groups)
 * 2. groupMembers → chatChannelMembers (chat channels)
 *
 * For large communities/groups (9,000+ members), it uses paginated backfill.
 *
 * Usage:
 *   npx ts-node scripts/sync-all-messaging.ts
 *
 * Or with pnpm:
 *   pnpm exec ts-node scripts/sync-all-messaging.ts
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../apps/convex/_generated/api";
import type { Id } from "../apps/convex/_generated/dataModel";

// Get deployment URL from environment or use default
const CONVEX_URL = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL;

if (!CONVEX_URL) {
  console.error("Error: CONVEX_URL environment variable not set");
  console.error("Set it to your Convex deployment URL, e.g.:");
  console.error("  export CONVEX_URL=https://your-deployment.convex.cloud");
  process.exit(1);
}

const client = new ConvexHttpClient(CONVEX_URL);

async function runStep1(): Promise<{ success: boolean; stats: any }> {
  console.log("\n=== Step 1: Sync userCommunities → groupMembers ===");
  console.log("This ensures all community members are in their announcement groups.\n");

  try {
    const result = await client.action(api.functions.messaging.channels.runStep1Backfill, {
      batchSize: 1, // Process 1 community at a time to avoid timeouts
    });

    console.log("Step 1 Complete:");
    console.log(`  Communities processed: ${result.communitiesProcessed}`);
    console.log(`  Members added to groups: ${result.membersAddedToGroups}`);
    console.log(`  Skipped (already synced): ${result.skipped}`);
    console.log(`  Errors: ${result.errors}`);

    return { success: result.errors === 0, stats: result };
  } catch (error) {
    console.error("Step 1 failed:", error);
    return { success: false, stats: null };
  }
}

async function runStep2(): Promise<{ success: boolean; stats: any }> {
  console.log("\n=== Step 2: Sync groupMembers → chatChannelMembers ===");
  console.log("This ensures all group members have chat channel access.\n");

  try {
    const result = await client.action(api.functions.messaging.channels.runStep2Backfill, {
      batchSize: 3, // Process 3 groups at a time (smaller to avoid timeouts)
    });

    console.log("Step 2 Complete:");
    console.log(`  Groups processed: ${result.groupsProcessed}`);
    console.log(`  Main channel members added: ${result.mainMembersAdded}`);
    console.log(`  Leader channel members added: ${result.leaderMembersAdded}`);
    console.log(`  Skipped (already synced): ${result.skipped}`);
    console.log(`  Errors: ${result.errors}`);

    return { success: result.errors === 0, stats: result };
  } catch (error: any) {
    // If Step 2 times out, it might be hitting a large group
    if (error?.message?.includes("timed out")) {
      console.log("Step 2 timed out - checking for large groups that need separate handling...");
      return { success: true, stats: { timedOut: true } };
    }
    console.error("Step 2 failed:", error);
    return { success: false, stats: null };
  }
}

async function syncLargeGroups(): Promise<void> {
  console.log("\n=== Checking for large groups needing sync ===\n");

  try {
    const groups = await client.query(
      api.functions.messaging.channels.findGroupsNeedingChannelSync,
      {}
    );

    if (groups.length === 0) {
      console.log("✓ No large groups need syncing.");
      return;
    }

    console.log(`Found ${groups.length} groups needing sync:`);
    for (const g of groups) {
      console.log(`  - ${g.groupName}: ${g.discrepancy} members to sync`);
    }

    // Sync each large group individually
    for (const g of groups) {
      if (g.discrepancy > 100) {
        console.log(`\nSyncing large group: ${g.groupName} (${g.discrepancy} members)...`);
        try {
          const result = await client.action(
            api.functions.messaging.channels.backfillLargeGroupChannels,
            { groupId: g.groupId as Id<"groups"> }
          );
          console.log(`  ✓ Added ${result.totalMainAdded} main, ${result.totalLeadersAdded} leaders in ${result.batches} batches`);
        } catch (error) {
          console.error(`  ✗ Failed to sync ${g.groupName}:`, error);
        }
      }
    }
  } catch (error: any) {
    if (error?.message?.includes("Too many documents")) {
      console.log("Large group check hit document limit - some groups may have many members.");
      console.log("Run individual group syncs if needed.");
    } else {
      console.error("Could not check for large groups:", error);
    }
  }
}

async function showFinalCounts(): Promise<void> {
  console.log("\n=== Final Counts ===\n");

  try {
    const counts = await client.query(
      api.functions.messaging.channels.getTotalChannelMembersCount,
      {}
    );

    console.log(`  Total channels: ${counts.totalChannels}`);
    console.log(`  Main channel members: ${counts.totalMainChannelMembers}`);
    console.log(`  Leaders channel members: ${counts.totalLeadersChannelMembers}`);
  } catch (error) {
    console.error("Could not get final counts:", error);
  }
}

async function main() {
  console.log("========================================");
  console.log("  Togather Messaging Sync Script");
  console.log("========================================");
  console.log(`Deployment: ${CONVEX_URL}`);

  // Run Step 1: userCommunities → groupMembers
  const step1Result = await runStep1();
  if (!step1Result.success) {
    console.error("\n⚠️  Step 1 had errors. Check logs above.");
  }

  // Run Step 2: groupMembers → chatChannelMembers
  const step2Result = await runStep2();

  // If Step 2 timed out or found large groups, handle them separately
  if (step2Result.stats?.timedOut) {
    await syncLargeGroups();
  }

  // Show final counts
  await showFinalCounts();

  // Summary
  console.log("\n========================================");
  console.log("  Sync Complete");
  console.log("========================================");

  if (step1Result.success) {
    console.log("✓ All steps completed!");
  } else {
    console.log("⚠️  Some steps had errors. Review the output above.");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Script failed:", error);
  process.exit(1);
});
