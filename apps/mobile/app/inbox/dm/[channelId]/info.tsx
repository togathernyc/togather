/**
 * Direct Message Info Route
 *
 * Route: /inbox/dm/[channelId]/info
 *
 * Settings + member management surface for an ad-hoc DM/group_dm. Reached
 * by tapping the chat-room header. Mounts `ChatInfoScreen`, which reads
 * `channelId` from params.
 */
import { useLocalSearchParams } from "expo-router";
import { ChatInfoScreen } from "@features/chat/components/ChatInfoScreen";
import { DmFeatureGate } from "@features/chat/components/DmFeatureGate";
import type { Id } from "@services/api/convex";

export default function ChatInfoRoute() {
  const { channelId } = useLocalSearchParams<{ channelId: string }>();
  if (!channelId) return null;
  return (
    <DmFeatureGate>
      <ChatInfoScreen channelId={channelId as Id<"chatChannels">} />
    </DmFeatureGate>
  );
}
