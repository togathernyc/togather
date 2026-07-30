import { Redirect } from 'expo-router';
import { CommunityPageScreen } from '@features/community/components/CommunityPageScreen';
import { useWhatsappShellState } from '@hooks/useWhatsappShell';

export default function CommunityRoute() {
  // Defense in depth: honor the flag at the route itself, not just its
  // entry points (deep links / stale navigation state can bypass entries).
  const { enabled, loaded } = useWhatsappShellState();
  if (!loaded) return null;
  if (!enabled) return <Redirect href="/(tabs)/chat" />;
  return <CommunityPageScreen />;
}
