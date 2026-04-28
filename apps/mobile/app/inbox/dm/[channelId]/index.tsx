/**
 * Direct Message Channel Route
 *
 * Route: /inbox/dm/[channelId]
 *
 * Hosts the chat room for an ad-hoc 1:1 DM. The dynamic `[channelId]`
 * segment is the Convex `chatChannels` ID; ConvexChatRoomScreen reads it
 * from the route params (`params.channelId`) and resolves the active
 * channel from there.
 */
import { ConvexChatRoomScreen } from "@features/chat/components/ConvexChatRoomScreen";

export default ConvexChatRoomScreen;
