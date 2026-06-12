/**
 * Mock data for the demo (no-backend) bundle. Keyed by the dotted Convex
 * function path (e.g. `api.functions.users.me` -> "functions.users.me"). The
 * mock Convex client (./convex) looks values up here. Values may be a constant
 * or a function of the call args.
 *
 * The community list below mirrors a typical signed-in member so the rendered
 * screen matches the real app.
 */
export const fixtures: Record<string, unknown | ((args: unknown) => unknown)> = {
  // users.me -> the signed-in user's community memberships.
  "functions.users.me": {
    communityMemberships: [
      { communityId: "fount", communityName: "FOUNT", communityLogo: null, role: 1, communityLegacyId: null },
      { communityId: "demo", communityName: "Demo Community", communityLogo: null, role: 3, communityLegacyId: null },
      { communityId: "mdrun", communityName: "MD Run Club", communityLogo: null, role: 3, communityLegacyId: null },
      { communityId: "mnpaint", communityName: "MN Painters", communityLogo: null, role: 3, communityLegacyId: null },
      { communityId: "union", communityName: "Union church", communityLogo: null, role: 3, communityLegacyId: null },
    ],
  },

  // Community search — return nothing so the featured/search sections stay hidden.
  "functions.resources.communitySearch": { data: [] },

  // Mutations/actions invoked only on press — return benign values.
  "functions.users.clearActiveCommunity": null,
  "functions.communities.leave": null,
  "functions.authInternal.selectCommunityForUser": null,
};
