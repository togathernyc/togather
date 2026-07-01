// Stub signatures for the Event Tasks feature — real logic lands in Agent A's pass.

import { v } from "convex/values";
import { query } from "../../_generated/server";

/**
 * Whether the current user can enter Serving Mode and, if so, the active plan
 * they'd serve on. `autoEnter` hints the client to jump straight in.
 */
export const getServingEligibility = query({
  args: {},
  handler: async (_ctx, _args) => {
    return {
      eligible: false,
      autoEnter: false,
      activePlan: null as null | {
        planId: string;
        groupId: string;
        title: string;
        startsAt: number;
        endsAt: number;
        teamIds: string[];
        teamChannelIds: string[];
        meetingChannelIds: string[];
      },
    };
  },
});

/**
 * Resolve the set of chat channel ids relevant to a plan's serving context
 * (team channels + linked meeting channels). Agent D imports this into
 * `messaging/channels.ts`; Agent A fills in the real resolution.
 */
export async function resolveServingChannelIds(
  ctx: any,
  planId: any,
): Promise<Set<string>> {
  return new Set();
}
