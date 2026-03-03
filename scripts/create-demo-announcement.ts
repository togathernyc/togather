/**
 * Create announcement group for Demo Community (ID 35)
 */

import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

async function create() {
  const communityId = 35n;

  // Check if already exists
  const existing = await prisma.group.findFirst({
    where: { community_id: communityId, is_announcement_group: true }
  });

  if (existing) {
    console.log('Announcement group already exists:', existing.id);
    return;
  }

  // Get or create group type
  let groupType = await prisma.group_type.findFirst({
    where: { community_id: communityId, slug: 'announcements' }
  });

  if (!groupType) {
    groupType = await prisma.group_type.create({
      data: {
        name: 'Announcements',
        slug: 'announcements',
        description: 'Community-wide announcements',
        community_id: communityId,
        is_active: true,
        display_order: 0,
        created_at: new Date(),
      }
    });
    console.log('Created group type:', groupType.id);
  }

  // Create announcement group
  const groupId = randomUUID();
  await prisma.group.create({
    data: {
      id: groupId,
      name: 'Announcements',
      description: 'Stay updated with community-wide announcements',
      community_id: communityId,
      group_type_id: groupType.id,
      is_announcement_group: true,
      is_archived: false,
      created_at: new Date(),
      updated_at: new Date(),
    }
  });

  console.log('Created announcement group:', groupId);
  console.log('Members will be added JIT when they load the inbox.');

  await prisma.$disconnect();
}

create().catch(console.error);
