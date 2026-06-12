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

  // --- Prayer feed -------------------------------------------------------
  "functions.prayers.feed": [
    {
      id: "p1",
      bodyText:
        "Please pray for my mom — she has surgery on Thursday and we're all a little anxious about the recovery.",
      prayedForCount: 4,
      status: "active",
      createdAt: Date.now() - 1000 * 60 * 60 * 3,
      archivedAt: null,
      authorDisplayName: "Sarah M.",
      crisisFlag: false,
    },
    {
      id: "p2",
      bodyText:
        "Starting a new job next week after a long search. Praying for confidence and a smooth first few days.",
      prayedForCount: 1,
      status: "active",
      createdAt: Date.now() - 1000 * 60 * 60 * 26,
      archivedAt: null,
      authorDisplayName: null,
      crisisFlag: false,
    },
    {
      id: "p3",
      bodyText:
        "Grateful for this community. Please pray for our small group as we welcome three new families this month.",
      prayedForCount: 9,
      status: "active",
      createdAt: Date.now() - 1000 * 60 * 60 * 50,
      archivedAt: null,
      authorDisplayName: "Daniel K.",
      crisisFlag: false,
    },
  ],
  "functions.prayers.myPrayedThisWeekCount": { today: 1, week: 4 },
  "functions.prayers.myPrayedFor": [
    {
      id: "pp1",
      bodyText: "Travel safety for our youth group retreat this weekend.",
      prayedForCount: 6,
      status: "active",
      createdAt: Date.now() - 1000 * 60 * 60 * 72,
      prayedAt: Date.now() - 1000 * 60 * 60 * 5,
      archivedAt: null,
      authorDisplayName: "Maria G.",
      crisisFlag: false,
    },
    {
      id: "pp2",
      bodyText: "Healing for a friend recovering from surgery.",
      prayedForCount: 3,
      status: "active",
      createdAt: Date.now() - 1000 * 60 * 60 * 96,
      prayedAt: Date.now() - 1000 * 60 * 60 * 28,
      archivedAt: null,
      authorDisplayName: null,
      crisisFlag: false,
    },
  ],
  "functions.prayers.notifications.getPrayerNotificationPreferences": {
    masterEnabled: true,
    prayedFor: true,
    followUps: true,
  },
  "functions.prayers.notifications.setMasterPrayerNotifications": { ok: true },
  "functions.prayers.recordPrayerSession": { alreadyPrayed: false },
  "functions.prayers.createPrayer": { prayerId: "pnew" },
  "functions.prayers.reportPrayer": { alreadyReported: false },
};
