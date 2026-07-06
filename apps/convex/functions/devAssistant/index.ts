/**
 * Dev-Assistant Bot — @Togather in-chat dev assistant + bug pipeline (MVP)
 *
 * Mention @Togather in a staff chat thread to turn a discussion into a clean
 * bug brief. The agent opens a bug (devBugs), iterates the brief in-thread, and
 * once marked READY_FOR_IMPL hands it to a Claude Code Routine (outbound POST)
 * which writes code, opens a PR, and reports back via a signed HTTP callback.
 *
 * Gated behind the "dev-assistant-bot" feature flag. Triggerable by Togather
 * staff/superusers and by delegated dev maintainers (see maintainers.ts);
 * reviewing/merging stays superuser-only.
 *
 * - bugs.ts        — devBugs DB ops + token-authed review-screen queries
 * - maintainers.ts — dev_maintainer role grants + trigger-access helpers
 * - contributions.ts — contributor dev dashboard surface (ADR-029): dashboard
 *   submissions, spec approval, and risk-gated build dispatch
 * - agent.ts    — OpenAI tool-use loop (gpt-4o, vision for screenshots)
 * - tools.ts    — tool definitions + dispatcher
 * - prompts.ts  — brief-synthesis system prompt
 * - actions.ts  — processThreadMention / dispatchBug / dispatchSpec /
 *   handleRoutineCallback
 *
 * The inbound callback HTTP route lives in apps/convex/http.ts.
 */

import { query } from "../../_generated/server";
import { Id } from "../../_generated/dataModel";

/** Sentinel bot user, seeded by seed.ts (username "togather_bot"). */
export const BOT_USERNAME = "togather_bot";

/**
 * Resolve the seeded sentinel bot user's id. Used by the mobile composer to add
 * a synthetic "@Togather" autocomplete entry, and as the mention target the
 * onMessageSent hot path checks against. Returns null if not seeded yet.
 */
export const getBotUserId = query({
  args: {},
  handler: async (ctx): Promise<Id<"users"> | null> => {
    const bot = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", BOT_USERNAME))
      .first();
    return bot?._id ?? null;
  },
});
