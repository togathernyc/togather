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
 */
import { ConvexChatRoomScreen } from "@features/chat/components/ConvexChatRoomScreen";

export default ConvexChatRoomScreen;
