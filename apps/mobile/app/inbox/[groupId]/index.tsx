/**
 * Group Chat Index Route
 *
 * Redirects from /inbox/[groupId] to /inbox/[groupId]/general
 * This ensures a consistent URL structure for chat navigation.
 *
 * Reserved-name guard: if `groupId` matches a sibling literal route
 * (`new`, `requests`, `dm`), expo-router has resolved this dynamic file
 * spuriously — redirect to that literal route instead of building a
 * nonsense URL like `/inbox/new/general`. Without this guard the
 * downstream `[channelSlug]` screen mounts `ConvexChatRoomScreen` with
 * `groupId="new"`, which fails Convex's `v.id("groups")` validator on
 * `listGroupChannels` ("ArgumentValidationError: Value does not match
 * validator. Path: .groupId Value: \"new\"").
 */
import { useLocalSearchParams, Redirect } from "expo-router";

const RESERVED_INBOX_ROUTES: ReadonlySet<string> = new Set([
  "new",
  "requests",
  "dm",
]);

export default function GroupChatIndexRoute() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();

  if (groupId && RESERVED_INBOX_ROUTES.has(groupId)) {
    return <Redirect href={`/inbox/${groupId}` as any} />;
  }

  // Redirect to general tab by default
  return <Redirect href={`/inbox/${groupId}/general`} />;
}
