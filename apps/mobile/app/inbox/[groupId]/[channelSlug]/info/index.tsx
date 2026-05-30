/**
 * Channel Info Route
 *
 * Route: /inbox/[groupId]/[channelSlug]/info
 *
 * Mounts `ChannelInfoScreen` for every channel, including General
 * (channelType === "main"). General's info page is where a leader reaches
 * the Active state control to disable/re-enable it.
 */
import { useLocalSearchParams } from "expo-router";
import { ChannelInfoScreen } from "@features/chat/components/ChannelInfoScreen";

export default function ChannelInfoRoute() {
  const { groupId, channelSlug } = useLocalSearchParams<{
    groupId: string;
    channelSlug: string;
  }>();

  if (!groupId || !channelSlug) return null;

  return <ChannelInfoScreen groupId={groupId} channelSlug={channelSlug} />;
}
