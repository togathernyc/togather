/**
 * KnicksModeSync - Bridges the app-wide Knicks mode feature flag up to the
 * ThemeProvider.
 *
 * ThemeProvider sits ABOVE AuthProvider in the tree, so it can't read auth
 * state directly. This component lives inside the auth tree, reads the
 * resolved `knicks_mode` flag (sourced from the "knicks-mode" feature flag,
 * flipped in /admin/features), and pushes it into the theme via
 * `setKnicksMode`. Knicks mode is OFF by default.
 *
 * Renders nothing.
 */
import { useEffect } from 'react';
import { useAuth } from '@providers/AuthProvider';
import { useTheme } from '@hooks/useTheme';

export function KnicksModeSync() {
  const { user } = useAuth();
  const { setKnicksMode } = useTheme();

  const knicksMode = user?.knicks_mode === true;

  useEffect(() => {
    setKnicksMode(knicksMode);
  }, [knicksMode, setKnicksMode]);

  return null;
}
