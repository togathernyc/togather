#!/usr/bin/env npx tsx
/**
 * Quick script to check record counts in Convex
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

async function checkCounts() {
  let convexUrl = process.env.CONVEX_SITE_URL;
  if (!convexUrl) throw new Error("CONVEX_SITE_URL required");
  convexUrl = convexUrl.replace(".convex.site", ".convex.cloud");

  const convex = new ConvexHttpClient(convexUrl);
  console.log(`Checking ${convexUrl}...\n`);

  // Query each table we're syncing
  const counts = {
    communities: 0,
    users: 0,
    groupTypes: 0,
    groups: 0,
    groupMembers: 0,
    meetings: 0,
    userCommunities: 0,
    meetingRsvps: 0,
    meetingAttendances: 0,
    notifications: 0,
    pushTokens: 0,
  };

  // Use internal queries to count
  try {
    // @ts-ignore - internal query
    const result = await convex.query(api.functions.admin.getCounts as any, {});
    console.log("Admin getCounts result:", result);
  } catch (e: any) {
    console.log("No getCounts function available, trying alternative...");
  }

  // Just check if we can get a single record from each table
  try {
    const communities = await convex.query(api.functions.communities.listPublic as any, {});
    console.log("Communities:", communities);
  } catch (e: any) {
    console.log("Could not query communities:", e.message);
  }
}

checkCounts();
