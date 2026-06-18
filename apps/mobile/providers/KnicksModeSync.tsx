/**
 * KnicksModeSync - Bridges the active community's `knicksMode` setting up to
 * the ThemeProvider.
 *
 * ThemeProvider sits ABOVE AuthProvider in the tree, so it can't read auth
 * state directly. This component lives inside the auth tree, reads the
 * resolved `community_knicks_mode` flag, and pushes it into the theme via
 * `setKnicksMode`. Knicks mode is ON by default — only an explicit `false`
 * from the community setting turns it off.
 *
 * Renders nothing.
 */
import { useEffect } from 'react';
import { useAuth } from '@providers/AuthProvider';
import { useTheme } from '@hooks/useTheme';

export function KnicksModeSync() {
  const { user } = useAuth();
  const { setKnicksMode } = useTheme();

  const knicksMode = user?.community_knicks_mode !== false;

  useEffect(() => {
    setKnicksMode(knicksMode);
  }, [knicksMode, setKnicksMode]);

  return null;
}
