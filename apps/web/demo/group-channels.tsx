/**
 * DEMO: render the REAL mobile-app `ChannelsSection` on the web with mock data
 * and no backend. This is the CHANNELS card from a group's detail page — the
 * General / Leaders / Announcements / Reach Out channel list.
 *
 * The real component is rendered via react-native-web inside the app's real
 * ThemeProvider. Its Convex, auth, router, icon, and theme dependencies are
 * swapped for the mock modules under ./harness via aliases in vite.config.ts.
 *
 * `ChannelsSection` takes `groupId`/`userRole` as PROPS (not route params), so
 * no expo-router stub gymnastics are needed. We pass `userRole="leader"` so the
 * full set of channels (incl. the leader-only Reach Out + Create Channel row)
 * renders. Channels come from the `listGroupChannels` fixture registered below.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "../../mobile/providers/ThemeProvider";
import { AuthProvider } from "./harness/AuthProvider";
import { registerFixtures } from "./harness/convex";
import { ChannelsSection } from "../../mobile/features/groups/components/ChannelsSection";

registerFixtures({
  // The group's channels, in the shape returned by listGroupChannels.
  "functions.messaging.channels.listGroupChannels": [
    {
      _id: "ch_general",
      slug: "general",
      channelType: "main",
      name: "General",
      memberCount: 24,
      isArchived: false,
      isMember: true,
      role: "member",
      unreadCount: 3,
      isPinned: false,
      isEnabled: true,
    },
    {
      _id: "ch_leaders",
      slug: "leaders",
      channelType: "leaders",
      name: "Leaders",
      memberCount: 4,
      isArchived: false,
      isMember: true,
      role: "leader",
      unreadCount: 0,
      isPinned: false,
      isEnabled: true,
    },
    {
      _id: "ch_announcements",
      slug: "announcements",
      channelType: "announcements",
      name: "Announcements",
      memberCount: 24,
      isArchived: false,
      isMember: true,
      role: "member",
      unreadCount: 1,
      isPinned: true,
      isEnabled: true,
    },
    {
      _id: "ch_reachout",
      slug: "reach-out",
      channelType: "reach_out",
      name: "Reach Out",
      memberCount: 4,
      isArchived: false,
      isMember: true,
      role: "leader",
      unreadCount: 0,
      isPinned: false,
      isEnabled: true,
    },
    {
      _id: "ch_prayer",
      slug: "prayer",
      channelType: "custom",
      name: "Prayer & Care",
      memberCount: 12,
      isArchived: false,
      isMember: true,
      role: "member",
      unreadCount: 0,
      isPinned: false,
      isEnabled: true,
    },
  ],

  // Leader-only side queries — empty so no banners/invites appear.
  "functions.messaging.sharedChannels.listPendingInvitesForGroup": [],
  "functions.messaging.channelInvites.getPendingRequestCountByGroup": { count: 0, firstChannelSlug: null },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <ChannelsSection groupId="g1" userRole="leader" />
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
);
