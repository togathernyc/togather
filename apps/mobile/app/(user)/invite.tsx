import { Redirect } from 'expo-router';
import { InviteKitScreen } from '@features/invite/components/InviteKitScreen';
import { useWhatsappShellState } from '@hooks/useWhatsappShell';

export default function InviteRoute() {
  // Defense in depth: entry points are flag-gated, but a deep link or stale
  // navigation state could still reach this route — honor the flag (and its
  // kill switch) here too. Wait for `loaded` so flag-on users aren't bounced
  // during the initial flag fetch.
  const { enabled, loaded } = useWhatsappShellState();
  if (!loaded) return null;
  if (!enabled) return <Redirect href="/(tabs)/profile" />;
  return <InviteKitScreen />;
}
