import { internalMutation } from "../_generated/server";
import { generateChannelSlug } from "../lib/slugs";

/**
 * Migration to add slugs to existing chatChannels.
 *
 * Run with: npx convex run migrations/addChannelSlugs:addSlugsToExistingChannels
 */
export const addSlugsToExistingChannels = internalMutation({
  handler: async (ctx) => {
    const channels = await ctx.db.query("chatChannels").collect();

    let migratedCount = 0;
    let skippedCount = 0;

    // Track slugs assigned during this migration per group
    // This is necessary because DB queries only see pre-mutation state
    const assignedSlugsPerGroup = new Map<string, Set<string>>();

    // Initialize with existing slugs from DB
    for (const channel of channels) {
      if (!channel.groupId) continue; // Skip ad-hoc channels (DM/group_dm)
      if (channel.slug) {
        const groupSlugs = assignedSlugsPerGroup.get(channel.groupId) || new Set();
        groupSlugs.add(channel.slug);
        assignedSlugsPerGroup.set(channel.groupId, groupSlugs);
      }
    }

    for (const channel of channels) {
      if (!channel.groupId) {
        skippedCount++;
        continue; // Skip ad-hoc channels (DM/group_dm)
      }
      // Skip if already has slug
      if (channel.slug) {
        skippedCount++;
        continue;
      }

      // Get or create the set of slugs for this group
      const groupSlugs = assignedSlugsPerGroup.get(channel.groupId) || new Set();

      // Determine slug based on channel type
      let slug: string;

      if (channel.channelType === "main") {
        slug = "general";
      } else if (channel.channelType === "leaders") {
        slug = "leaders";
      } else {
        // Custom channels - use generateChannelSlug to handle reserved slugs and collisions
        // Pass all assigned slugs (from DB + from this migration) to avoid duplicates
        const existingSlugs = Array.from(groupSlugs);
        slug = generateChannelSlug(channel.name, existingSlugs);
      }

      // Handle collision with slugs assigned in this migration
      // (DB queries won't see them due to snapshot isolation)
      if (groupSlugs.has(slug)) {
        let counter = 2;
        let uniqueSlug = `${slug}-${counter}`;

        while (groupSlugs.has(uniqueSlug)) {
          counter++;
          uniqueSlug = `${slug}-${counter}`;
        }

        slug = uniqueSlug;
      }

      // Track the assigned slug for future iterations
      groupSlugs.add(slug);
      assignedSlugsPerGroup.set(channel.groupId, groupSlugs);

      await ctx.db.patch(channel._id, { slug });
      migratedCount++;
    }

    console.log(`Migration complete: ${migratedCount} channels updated, ${skippedCount} skipped`);

    return {
      migratedCount,
      skippedCount,
      totalChannels: channels.length
    };
  },
});
