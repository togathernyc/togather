/**
 * Thread Page Route
 *
 * Route: /inbox/[groupId]/thread/[messageId]
 *
 * Displays a full-page thread view for a message, showing the parent message
 * at the top, replies below, and a reply input at the bottom.
 */
import { useLocalSearchParams } from "expo-router";
import type { Id } from "@services/api/convex";
import { ThreadPage } from "@features/chat/components/ThreadPage";

type ThreadRouteParams = {
  groupId: string;
  messageId: string;
  channelName?: string;
};

export default function ThreadRoute() {
  const params = useLocalSearchParams<ThreadRouteParams>();

  const { groupId, messageId, channelName } = params;

  if (!groupId || !messageId) {
    return null;
  }

  return (
    <ThreadPage
      messageId={messageId as Id<"chatMessages">}
      groupId={groupId as Id<"groups">}
      channelName={channelName}
    />
  );
}
