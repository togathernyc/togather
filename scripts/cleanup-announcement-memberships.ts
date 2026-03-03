/**
 * Cleanup Script: Remove all announcement group memberships
 *
 * This undoes the bulk migration and removes all group_member records
 * for announcement groups. The groups themselves remain.
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function cleanup() {
  console.log('='.repeat(60));
  console.log('Cleanup: Removing Announcement Group Memberships');
  console.log('='.repeat(60));
  console.log('');

  // Find all announcement groups
  const announcementGroups = await prisma.group.findMany({
    where: { is_announcement_group: true },
    select: { id: true, name: true, community_id: true }
  });

  console.log(`Found ${announcementGroups.length} announcement groups`);

  // Delete all memberships for announcement groups
  const result = await prisma.group_member.deleteMany({
    where: {
      group_id: { in: announcementGroups.map(g => g.id) }
    }
  });

  console.log(`Deleted ${result.count} group_member records`);
  console.log('');
  console.log('Done! Announcement groups still exist but have no members.');
  console.log('Members will be added on-demand when they load the inbox.');

  await prisma.$disconnect();
}

cleanup().catch(console.error);
