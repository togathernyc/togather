/**
 * Script to run the channel backfill
 * 
 * This script calls the backfill action to create channels for all groups.
 * 
 * Usage:
 *   npx tsx scripts/run-backfill-channels.ts
 */

import { ConvexHttpClient } from "convex/browser";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const CONVEX_URL = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;

if (!CONVEX_URL) {
  console.error("Error: CONVEX_URL or NEXT_PUBLIC_CONVEX_URL must be set in environment");
  console.error("Make sure you have a .env file with your Convex deployment URL");
  process.exit(1);
}

async function runBackfill() {
  console.log("Connecting to Convex:", CONVEX_URL);
  
  const client = new ConvexHttpClient(CONVEX_URL);
  
  try {
    console.log("Running channel backfill...");
    const result = await client.action("messaging/channels:runBackfill", {});
    
    console.log("\n✅ Backfill complete!");
    console.log(`   Total groups: ${result.totalGroups}`);
    console.log(`   Channels created: ${result.created}`);
    console.log(`   Groups skipped: ${result.skipped}`);
    if (result.errors > 0) {
      console.log(`   ⚠️  Errors: ${result.errors}`);
    }
  } catch (error) {
    console.error("❌ Error running backfill:", error);
    process.exit(1);
  }
}

runBackfill();

