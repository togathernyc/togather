/**
 * Direct Message Channel Route
 *
 * Route: /inbox/dm/[channelId]
 *
 * Hosts the chat room for an ad-hoc 1:1 or group DM. The dynamic
 * `[channelId]` segment is the Convex `chatChannels` ID;
 * `ConvexChatRoomScreen` reads it from the route params (`params.channelId`)
 * and resolves the active channel from there.
 *
 * Behind the `direct-messages` PostHog flag — see `DmFeatureGate` for the
 * placeholder shown when the flag is off.
 */
import { ConvexChatRoomScreen } from "@features/chat/components/ConvexChatRoomScreen";
import { DmFeatureGate } from "@features/chat/components/DmFeatureGate";

export default function DirectMessageChannelRoute() {
  return (
    <DmFeatureGate>
      <ConvexChatRoomScreen />
    </DmFeatureGate>
  );
}
