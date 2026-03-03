import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
  // Find user by phone (try different formats)
  let user = await prisma.user.findFirst({
    where: { phone: '2025550123' },
    select: { id: true, first_name: true, active_community_id: true, phone: true }
  });

  if (!user) {
    user = await prisma.user.findFirst({
      where: { phone: '+12025550123' },
      select: { id: true, first_name: true, active_community_id: true, phone: true }
    });
  }

  if (!user) {
    // List users with similar phones
    const users = await prisma.user.findMany({
      where: { phone: { contains: '2025550123' } },
      select: { id: true, phone: true, first_name: true },
      take: 5
    });
    console.log('Users with similar phones:', users);
  }

  console.log('User:', user);

  if (!user || !user.active_community_id) {
    console.log('User not found or no active community');

    // List all announcement groups anyway
    const allAnnouncements = await prisma.group.findMany({
      where: { is_announcement_group: true },
      select: { id: true, name: true, community_id: true }
    });
    console.log('All announcement groups:', allAnnouncements);

    // List all communities
    const communities = await prisma.community.findMany({
      select: { id: true, name: true },
      take: 10
    });
    console.log('Communities:', communities);
    return;
  }

  // Check announcement groups in user's community
  const announcementGroups = await prisma.group.findMany({
    where: {
      community_id: user.active_community_id,
      is_announcement_group: true
    },
    select: { id: true, name: true, community_id: true }
  });
  console.log('Announcement groups in community:', announcementGroups);

  // Check if user is member of any announcement group
  if (announcementGroups.length > 0) {
    const membership = await prisma.group_member.findFirst({
      where: {
        user_id: user.id,
        group_id: announcementGroups[0].id,
        left_at: null
      }
    });
    console.log('User membership in announcement group:', membership);
  } else {
    console.log('No announcement group exists for this community');

    // List all communities
    const communities = await prisma.community.findMany({
      select: { id: true, name: true }
    });
    console.log('All communities:', communities);

    // Check which community has announcement group
    const groupsWithAnnouncement = await prisma.group.findMany({
      where: { is_announcement_group: true },
      select: { id: true, name: true, community_id: true }
    });
    console.log('Communities with announcement groups:', groupsWithAnnouncement);
  }

  await prisma.$disconnect();
}

check().catch(console.error);
