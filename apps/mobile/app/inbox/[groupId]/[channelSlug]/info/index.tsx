/**
 * Channel Info Route
 *
 * Route: /inbox/[groupId]/[channelSlug]/info
 *
 * Mounts `ChannelInfoScreen` for non-General channels. For General
 * (channelType === "main") the group page IS the channel info, so we
 * redirect there on mount.
 *
 * The "general" slug always maps to channelType "main", so the redirect
 * fires synchronously without a flash of the info screen.
 */
import { Redirect, useLocalSearchParams } from "expo-router";
import { ChannelInfoScreen } from "@features/chat/components/ChannelInfoScreen";

export default function ChannelInfoRoute() {
  const { groupId, channelSlug } = useLocalSearchParams<{
    groupId: string;
    channelSlug: string;
  }>();

  if (!groupId || !channelSlug) return null;

  // General -> the group page IS the info surface for the main channel.
  if (channelSlug === "general") {
    return <Redirect href={`/groups/${groupId}` as any} />;
  }

  return <ChannelInfoScreen groupId={groupId} channelSlug={channelSlug} />;
}
