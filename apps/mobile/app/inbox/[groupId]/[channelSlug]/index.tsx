/**
 * Channel Slug Index Route
 *
 * Route: /inbox/[groupId]/[channelSlug]
 * Where channelSlug is "general", "leaders", or a custom channel slug
 *
 * This route provides URL-based routing for the chat system,
 * allowing tab state to be reflected in the URL for better navigation
 * and deep linking support.
 *
 * Standard slugs:
 * - "general" - Maps to the main channel (channelType: "main")
 * - "leaders" - Maps to the leaders channel (channelType: "leaders")
 * - Custom slugs - Custom channels created by group leaders
 *
 * Reserved-name guard: if `groupId` is one of the sibling literal route
 * names (`new`, `requests`, `dm`), the dynamic resolver landed on this
 * file spuriously. Redirect away before mounting `ConvexChatRoomScreen`
 * so it doesn't fire `listGroupChannels({ groupId: "new" })` and crash
 * Convex's `v.id("groups")` validator. See `[groupId]/index.tsx` for
 * the same guard at the parent level.
 */
import { Redirect, useLocalSearchParams } from "expo-router";
import { ConvexChatRoomScreen } from "@features/chat/components/ConvexChatRoomScreen";

const RESERVED_INBOX_ROUTES: ReadonlySet<string> = new Set([
  "new",
  "requests",
  "dm",
]);

export default function ChannelSlugRoute() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  if (groupId && RESERVED_INBOX_ROUTES.has(groupId)) {
    return <Redirect href={`/inbox/${groupId}` as any} />;
  }
  return <ConvexChatRoomScreen />;
}
