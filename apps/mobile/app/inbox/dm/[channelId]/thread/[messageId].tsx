/**
 * DM Thread Page Route
 *
 * Route: /inbox/dm/[channelId]/thread/[messageId]
 *
 * Mirrors `/inbox/[groupId]/thread/[messageId]` for ad-hoc DMs and group_dms,
 * which have a `communityId` instead of a `groupId`. Renders the same
 * `ThreadPage` component in DM mode (no leader/admin role concept; back-nav
 * returns to the DM channel).
 */
import { useLocalSearchParams } from "expo-router";
import type { Id } from "@services/api/convex";
import { ThreadPage } from "@features/chat/components/ThreadPage";

type DmThreadRouteParams = {
  channelId: string;
  messageId: string;
};

export default function DmThreadRoute() {
  const params = useLocalSearchParams<DmThreadRouteParams>();
  const { channelId, messageId } = params;

  if (!channelId || !messageId) {
    return null;
  }

  return (
    <ThreadPage
      messageId={messageId as Id<"chatMessages">}
      dmChannelId={channelId as Id<"chatChannels">}
    />
  );
}
