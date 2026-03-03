import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

let convexUrl = process.env.CONVEX_SITE_URL || "";
// Convert .convex.site to .convex.cloud if needed
convexUrl = convexUrl.replace(".convex.site", ".convex.cloud");
console.log(`Connecting to ${convexUrl}...`);
const client = new ConvexHttpClient(convexUrl);

async function main() {
  console.log("\n=== Checking for duplicates ===");

  let allGood = true;

  // Check communities
  let cursor: string | undefined = undefined;
  const communities: { legacyId: string; convexId: string }[] = [];
  do {
    const result = await client.query(api.functions.syncHelpers.getCommunityMappings, { cursor });
    communities.push(...result.items);
    cursor = result.isDone ? undefined : result.cursor;
  } while (cursor);

  const communityLegacyIds = communities.map(c => c.legacyId);
  const uniqueCommunityIds = new Set(communityLegacyIds);
  const communityDupes = communityLegacyIds.length - uniqueCommunityIds.size;
  if (communityDupes > 0) {
    console.log(`  ❌ Communities: Found ${communityDupes} duplicates out of ${communities.length} records`);
    allGood = false;
  } else {
    console.log(`  ✅ Communities: ${communities.length} records, no duplicates`);
  }

  // Check users
  cursor = undefined;
  const users: { legacyId: string; convexId: string }[] = [];
  do {
    const result = await client.query(api.functions.syncHelpers.getUserMappings, { cursor });
    users.push(...result.items);
    cursor = result.isDone ? undefined : result.cursor;
  } while (cursor);

  const userLegacyIds = users.map(u => u.legacyId);
  const uniqueUserIds = new Set(userLegacyIds);
  const userDupes = userLegacyIds.length - uniqueUserIds.size;
  if (userDupes > 0) {
    console.log(`  ❌ Users: Found ${userDupes} duplicates out of ${users.length} records`);
    allGood = false;
  } else {
    console.log(`  ✅ Users: ${users.length} records, no duplicates`);
  }

  // Check groups
  cursor = undefined;
  const groups: { legacyId: string; convexId: string }[] = [];
  do {
    const result = await client.query(api.functions.syncHelpers.getGroupMappings, { cursor });
    groups.push(...result.items);
    cursor = result.isDone ? undefined : result.cursor;
  } while (cursor);

  const groupLegacyIds = groups.map(g => g.legacyId);
  const uniqueGroupIds = new Set(groupLegacyIds);
  const groupDupes = groupLegacyIds.length - uniqueGroupIds.size;
  if (groupDupes > 0) {
    console.log(`  ❌ Groups: Found ${groupDupes} duplicates out of ${groups.length} records`);
    allGood = false;
  } else {
    console.log(`  ✅ Groups: ${groups.length} records, no duplicates`);
  }

  // Check meetings
  cursor = undefined;
  const meetings: { legacyId: number; convexId: string }[] = [];
  do {
    const result = await client.query(api.functions.syncHelpers.getMeetingMappings, { cursor });
    meetings.push(...result.items);
    cursor = result.isDone ? undefined : result.cursor;
  } while (cursor);

  const meetingLegacyIds = meetings.map(m => m.legacyId);
  const uniqueMeetingIds = new Set(meetingLegacyIds);
  const meetingDupes = meetingLegacyIds.length - uniqueMeetingIds.size;
  if (meetingDupes > 0) {
    console.log(`  ❌ Meetings: Found ${meetingDupes} duplicates out of ${meetings.length} records`);
    allGood = false;
  } else {
    console.log(`  ✅ Meetings: ${meetings.length} records, no duplicates`);
  }

  console.log(allGood ? "\n✅ All tables verified - no duplicates found!" : "\n❌ Some tables have duplicates");
}

main().catch(console.error);
