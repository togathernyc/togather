/**
 * Group Chat Index Route
 *
 * Redirects from /inbox/[groupId] to /inbox/[groupId]/general
 * This ensures a consistent URL structure for chat navigation.
 */
import { useLocalSearchParams, Redirect } from "expo-router";

export default function GroupChatIndexRoute() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();

  // Redirect to general tab by default
  return <Redirect href={`/inbox/${groupId}/general`} />;
}
