#!/usr/bin/env npx tsx
/**
 * Export group members to CSV ordered by join date
 *
 * Run with: infisical run --env=prod -- npx tsx scripts/export-group-members.ts "Midtown East"
 */

import { ConvexHttpClient } from "convex/browser";
import * as fs from "fs";

// Type definitions for Convex data
interface Group {
  _id: string;
  name: string;
  communityId: string;
}

interface GroupMember {
  _id: string;
  groupId: string;
  userId: string;
  role: string;
  joinedAt: number;
  leftAt?: number;
  requestStatus?: string;
}

interface User {
  _id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
}

async function main() {
  const convexUrl = process.env.CONVEX_URL || process.env.CONVEX_SITE_URL;
  if (!convexUrl) {
    console.error("❌ CONVEX_URL or CONVEX_SITE_URL required");
    process.exit(1);
  }

  const searchTerm = process.argv[2];
  if (!searchTerm) {
    console.error("❌ Please provide a group name search term");
    console.error("Usage: npx tsx scripts/export-group-members.ts \"Midtown East\"");
    process.exit(1);
  }

  console.log(`Connecting to: ${convexUrl}`);
  const convex = new ConvexHttpClient(convexUrl);

  // Step 1: Search for groups matching the name
  console.log(`\nSearching for groups matching: "${searchTerm}"...`);

  // Use internal query to search for groups
  const allGroups = await convex.query(({ db }) => {
    return db.query("groups").collect();
  }) as Group[];

  const matchingGroups = allGroups.filter(
    (g) => g.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (matchingGroups.length === 0) {
    console.error(`❌ No groups found matching "${searchTerm}"`);
    process.exit(1);
  }

  console.log(`Found ${matchingGroups.length} matching group(s):`);
  matchingGroups.forEach((g, i) => {
    console.log(`  ${i + 1}. ${g.name} (ID: ${g._id})`);
  });

  // For now, use the first match. In a more interactive script, we'd prompt the user.
  const group = matchingGroups[0];
  console.log(`\nUsing group: ${group.name}`);

  // Step 2: Get all members of this group
  console.log(`\nFetching members...`);

  const allMembers = await convex.query(({ db }) => {
    return db.query("groupMembers").collect();
  }) as GroupMember[];

  const groupMembers = allMembers.filter(
    (m) => m.groupId === group._id &&
           !m.leftAt && // Still active
           (!m.requestStatus || m.requestStatus === "accepted") // Approved or no request needed
  );

  console.log(`Found ${groupMembers.length} active members`);

  // Step 3: Get user details for each member
  console.log(`\nFetching user details...`);

  const allUsers = await convex.query(({ db }) => {
    return db.query("users").collect();
  }) as User[];

  const userMap = new Map(allUsers.map((u) => [u._id, u]));

  // Step 4: Combine and sort by joinedAt
  const membersWithDetails = groupMembers
    .map((m) => {
      const user = userMap.get(m.userId);
      return {
        firstName: user?.firstName || "",
        lastName: user?.lastName || "",
        email: user?.email || "",
        phone: user?.phone || "",
        role: m.role,
        joinedAt: m.joinedAt,
        joinedAtFormatted: new Date(m.joinedAt).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
      };
    })
    .sort((a, b) => a.joinedAt - b.joinedAt); // Ascending order (earliest first)

  console.log(`\nMembers sorted by join date (earliest first):`);

  // Step 5: Create CSV
  const escape = (s: string) => `"${(s || "").replace(/"/g, '""')}"`;
  const csvLines = [
    "Order,First Name,Last Name,Email,Phone,Role,Joined At",
  ];

  membersWithDetails.forEach((m, index) => {
    csvLines.push(
      [
        index + 1,
        escape(m.firstName),
        escape(m.lastName),
        escape(m.email),
        escape(m.phone),
        escape(m.role),
        escape(m.joinedAtFormatted),
      ].join(",")
    );
    // Also print to console
    console.log(
      `  ${index + 1}. ${m.firstName} ${m.lastName} - Joined: ${m.joinedAtFormatted}`
    );
  });

  // Step 6: Save CSV
  const groupNameSlug = group.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const timestamp = new Date().toISOString().split("T")[0];
  const filename = `${groupNameSlug}-members-${timestamp}.csv`;

  // Ensure exports directory exists
  const exportDir = `${process.cwd()}/exports`;
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }

  const exportPath = `${exportDir}/${filename}`;
  fs.writeFileSync(exportPath, csvLines.join("\n"));

  console.log(`\n✅ CSV saved to: ${exportPath}`);
  console.log(`📊 Total members: ${membersWithDetails.length}`);
}

main().catch(console.error);
