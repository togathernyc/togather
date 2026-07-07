/**
 * Contribution Detail Route
 *
 * Route: /dev/[id]
 * One contribution's conversation thread — chat with the AI builder, plan
 * review, staging verification, and GitHub links (ADR-029 Phase 1.5).
 *
 * On desktop web (>= 768px) this renders the two-pane split view with [id]
 * seeding the selection, so deep links land in the same sidebar + thread
 * layout as /dev. On phones it's the full-screen thread.
 */

import { useLocalSearchParams } from "expo-router";
import { ContributionDetailScreen } from "@features/contribute/components/ContributionDetailScreen";
import { ContributeSplitView } from "@features/contribute/components/ContributeSplitView";
import { useIsDesktopWeb } from "@hooks/useIsDesktopWeb";
import type { Id } from "@services/api/convex";

export default function ContributionDetailRoute() {
  const isDesktopWeb = useIsDesktopWeb();
  const params = useLocalSearchParams<{ id: string }>();
  if (isDesktopWeb) {
    return (
      <ContributeSplitView
        initialId={(params.id || null) as Id<"devBugs"> | null}
      />
    );
  }
  return <ContributionDetailScreen />;
}
