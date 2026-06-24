import { internalMutation } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { buildSearchText } from "../lib/utils";

/**
 * Ensure the @Togather dev-assistant sentinel bot user exists.
 *
 * Production-safe and idempotent: safe to run in any environment (dev, staging,
 * prod). A real users row (looked up by username) is what makes
 * `mentionedUserIds` resolve and the existing mention plumbing work unchanged;
 * the bot is inactive with no push tokens, so it's excluded from notification
 * fanout. This is the canonical creation path — `seedDemoData` also calls it,
 * but deployments that never run the demo seed must run this directly:
 *
 *   npx convex run migrations/ensureDevAssistantBotUser:ensureDevAssistantBotUser
 *
 * Without it, `getBotUserId` returns null, the composer can't add @Togather, and
 * the onMessageSent lookup can't trigger the agent even with the flag + routine
 * env vars enabled.
 */
export const ensureDevAssistantBotUser = internalMutation({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ status: "created" | "skipped"; userId: Id<"users"> }> => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", "togather_bot"))
      .first();
    if (existing) {
      console.log("[ensureDevAssistantBotUser] Bot user already exists");
      return { status: "skipped", userId: existing._id };
    }

    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      username: "togather_bot",
      firstName: "Togather",
      lastName: "Bot",
      searchText: buildSearchText({ firstName: "Togather", lastName: "Bot" }),
      isActive: false,
      isStaff: false,
      isSuperuser: false,
      pushNotificationsEnabled: false,
      emailNotificationsEnabled: false,
      smsNotificationsEnabled: false,
      timezone: "America/New_York",
      dateJoined: now,
      createdAt: now,
      updatedAt: now,
    });

    console.log("[ensureDevAssistantBotUser] Created bot user");
    return { status: "created", userId };
  },
});
