/**
 * KnicksModeSync - Bridges the app-wide Knicks mode feature flag up to the
 * ThemeProvider.
 *
 * ThemeProvider sits ABOVE the consumers in the tree, so it can't read the
 * flag directly. This component subscribes to the app-wide "knicks-mode"
 * feature flag (flipped in /admin/features) via a live Convex query and
 * pushes the value into the theme via `setKnicksMode`, so flipping the flag
 * updates the running app immediately — no relogin/profile refresh needed.
 * Knicks mode is OFF by default.
 *
 * Renders nothing.
 */
import { useEffect } from 'react';
import { useTheme } from '@hooks/useTheme';
import { useConvexFeatureFlag } from '@hooks/useConvexFeatureFlag';

export function KnicksModeSync() {
  const { setKnicksMode } = useTheme();
  const { enabled: knicksMode } = useConvexFeatureFlag('knicks-mode');

  useEffect(() => {
    setKnicksMode(knicksMode);
  }, [knicksMode, setKnicksMode]);

  return null;
}
