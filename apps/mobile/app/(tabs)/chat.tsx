import { Redirect } from "expo-router";
import { ChatInboxScreen } from "@features/chat/components/ChatInboxScreen";
import { useIsDesktopWeb } from "../../hooks/useIsDesktopWeb";

/**
 * Chat tab screen.
 * On desktop web, redirects to /inbox/ so the split layout renders.
 * On mobile, shows the inbox screen directly.
 */
export default function ChatTab() {
  const isDesktopWeb = useIsDesktopWeb();

  if (isDesktopWeb) {
    return <Redirect href="/inbox/" />;
  }

  return <ChatInboxScreen />;
}
