/**
 * Event Thread Route
 *
 * Route: /e/[shortId]/thread/[messageId]
 *
 * Event-scoped thread view. Reuses the shared ThreadPage component so
 * functionality matches the inbox thread route at /inbox/[groupId]/thread/...
 *
 * Why a separate route: pushing from /e/[shortId] to /inbox/... crosses
 * route stacks on native, which caused the thread page to render behind
 * the event page. Keeping the thread inside the /e/[shortId] stack lets
 * expo-router handle the push as a normal forward navigation.
 *
 * The owning group's id is passed via query param since the route only
 * knows the event shortId; EventComment forwards it when building the URL.
 */
import { useLocalSearchParams } from "expo-router";
import type { Id } from "@services/api/convex";
import { ThreadPage } from "@features/chat/components/ThreadPage";

type EventThreadRouteParams = {
  shortId: string;
  messageId: string;
  groupId?: string;
  channelName?: string;
};

export default function EventThreadRoute() {
  const params = useLocalSearchParams<EventThreadRouteParams>();

  const { messageId, groupId, channelName } = params;

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
