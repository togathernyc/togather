#!/usr/bin/env npx tsx
/**
 * Backfill Deleted User Sentinel
 *
 * This script:
 * 1. Creates the "Deleted User" sentinel if it doesn't exist
 * 2. Finds all records with undefined user references
 * 3. Updates them to point to the sentinel user
 *
 * Run with: op run --env-file=.env.production -- npx tsx scripts/backfill-deleted-user-sentinel.ts
 *
 * Add --dry-run to see what would be updated without actually updating
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../apps/convex/_generated/api";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  console.log("==============================================");
  console.log("Backfill Deleted User Sentinel");
  console.log("==============================================\n");

  if (dryRun) {
    console.log("*** DRY RUN MODE - No changes will be made ***\n");
  }

  const convexUrl = process.env.CONVEX_URL || process.env.CONVEX_SITE_URL;
  if (!convexUrl) {
    console.error("CONVEX_URL or CONVEX_SITE_URL required");
    process.exit(1);
  }

  console.log(`Connecting to: ${convexUrl}\n`);
  const convex = new ConvexHttpClient(convexUrl);

  // Step 1: Get or create the sentinel user
  console.log("Step 1: Getting or creating Deleted User sentinel...");

  let sentinelUserId: string;

  if (dryRun) {
    // In dry run, just check if it exists
    const existingId = await convex.query(api.functions.admin.getDeletedUserSentinelId, {});
    if (existingId) {
      sentinelUserId = existingId;
      console.log(`   Sentinel exists: ${sentinelUserId}\n`);
    } else {
      console.log("   Sentinel does not exist (would be created)\n");
      sentinelUserId = "dry-run-placeholder";
    }
  } else {
    const result = await convex.mutation(api.functions.admin.getOrCreateDeletedUserSentinel, {});
    sentinelUserId = result.userId;
    if (result.created) {
      console.log(`   Created new sentinel: ${sentinelUserId}\n`);
    } else {
      console.log(`   Using existing sentinel: ${sentinelUserId}\n`);
    }
  }

  // Step 2: Count records with undefined references
  console.log("Step 2: Counting records with undefined user references...");
  const counts = await convex.query(api.functions.admin.countUndefinedUserReferences, {});

  console.log(`   meetings.createdById = undefined: ${counts.meetings}`);
  console.log(`   chatMessages.senderId = undefined: ${counts.chatMessages}`);
  console.log(`   meetingGuests.userId = undefined: ${counts.meetingGuests}`);
  console.log(`   Total: ${counts.meetings + counts.chatMessages + counts.meetingGuests}\n`);

  if (counts.meetings + counts.chatMessages + counts.meetingGuests === 0) {
    console.log("No records need backfilling. Done!");
    process.exit(0);
  }

  if (dryRun) {
    console.log("*** DRY RUN - Would update the above records ***");
    process.exit(0);
  }

  // Step 3: Backfill each table
  console.log("Step 3: Backfilling references...\n");

  const tables = ["meetings", "chatMessages", "meetingGuests"] as const;
  const batchSize = 500;

  for (const table of tables) {
    const tableCount = table === "meetings" ? counts.meetings :
                       table === "chatMessages" ? counts.chatMessages :
                       counts.meetingGuests;

    if (tableCount === 0) {
      console.log(`   ${table}: 0 records, skipping`);
      continue;
    }

    console.log(`   ${table}: Processing ${tableCount} records...`);
    let totalUpdated = 0;

    while (totalUpdated < tableCount) {
      const result = await convex.mutation(api.functions.admin.backfillDeletedUserReferences, {
        sentinelUserId: sentinelUserId as any,
        table,
        limit: batchSize,
      });

      totalUpdated += result.updated;
      process.stdout.write(`\r   ${table}: ${totalUpdated}/${tableCount} updated`);

      if (result.updated === 0) {
        // No more records to update
        break;
      }
    }

    console.log(`\n   ${table}: Done (${totalUpdated} updated)`);
  }

  console.log("\n==============================================");
  console.log("BACKFILL COMPLETE");
  console.log("==============================================\n");

  // Verify
  console.log("Verifying...");
  const finalCounts = await convex.query(api.functions.admin.countUndefinedUserReferences, {});
  console.log(`   meetings.createdById = undefined: ${finalCounts.meetings}`);
  console.log(`   chatMessages.senderId = undefined: ${finalCounts.chatMessages}`);
  console.log(`   meetingGuests.userId = undefined: ${finalCounts.meetingGuests}`);

  if (finalCounts.meetings + finalCounts.chatMessages + finalCounts.meetingGuests === 0) {
    console.log("\nAll references have been backfilled to the Deleted User sentinel.");
  } else {
    console.log("\nNote: Some records may remain if they were created during backfill.");
  }
}

main().catch(console.error);
