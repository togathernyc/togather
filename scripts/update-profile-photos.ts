#!/usr/bin/env npx tsx
/**
 * Update Profile Photos
 *
 * Updates profile photos for Josh Kelsey and Mikey Akins to use the migrated R2 paths.
 *
 * Run with: infisical run --env=prod -- npx tsx scripts/update-profile-photos.ts
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../apps/convex/_generated/api";

const USERS_TO_UPDATE = [
  {
    name: "Josh Kelsey",
    phone: "+19172143460",
    profilePhoto: "r2:profiles/afc817ce-073b-4c1c-b564-5e7f24aab02c-42_69B82513-F7AE-4726-968A-9E5.jpg",
  },
  {
    name: "Mikey Akins",
    phone: "+17704023788",
    profilePhoto: "r2:profiles/878da03b-6a60-4cc5-a1ca-ffd671bb1887-profile-picture-456_zZWRLsf.jpg",
  },
];

async function main() {
  let convexUrl = process.env.CONVEX_SITE_URL || process.env.CONVEX_URL;
  if (!convexUrl) {
    console.error("CONVEX_SITE_URL or CONVEX_URL environment variable is required");
    process.exit(1);
  }
  convexUrl = convexUrl.replace(".convex.site", ".convex.cloud");

  console.log(`Connecting to Convex at ${convexUrl}...\n`);
  const convex = new ConvexHttpClient(convexUrl);

  for (const user of USERS_TO_UPDATE) {
    console.log(`Processing ${user.name} (${user.phone})...`);

    // Find user by phone
    const existingUser = await convex.query(api.functions.admin.getUserByPhone, {
      phone: user.phone,
    });

    if (!existingUser) {
      console.log(`  User not found in Convex!`);
      continue;
    }

    console.log(`  Found user: ${existingUser._id}`);
    console.log(`  Current photo: ${existingUser.profilePhoto || "(none)"}`);
    console.log(`  New photo: ${user.profilePhoto}`);

    // Update profile photo
    await convex.mutation(api.functions.admin.updateUserProfilePhoto, {
      userId: existingUser._id,
      profilePhoto: user.profilePhoto,
    });

    console.log(`  Updated profile photo successfully!`);
  }

  console.log("\nDone!");
}

main().catch(console.error);
