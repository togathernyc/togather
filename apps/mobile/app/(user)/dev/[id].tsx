/**
 * Contribution Detail Route
 *
 * Route: /dev/[id]
 * One contribution's conversation thread — chat with the AI builder, plan
 * review, staging verification, and GitHub links (ADR-029 Phase 1.5).
 *
 * On phones this is the full-screen thread. On desktop web (>= 768px) the
 * persistent sidebar lives in the layout (app/(user)/dev/_layout.tsx), so this
 * route renders only the right pane — the thread, keyed by id so per-conversation
 * state (draft, attachments) resets when you switch conversations.
 */

import { useLocalSearchParams } from "expo-router";
import { ContributionDetailScreen } from "@features/contribute/components/ContributionDetailScreen";
import { useIsDesktopWeb } from "@hooks/useIsDesktopWeb";
import type { Id } from "@services/api/convex";

export default function ContributionDetailRoute() {
  const isDesktopWeb = useIsDesktopWeb();
  const params = useLocalSearchParams<{ id: string }>();

  if (isDesktopWeb) {
    const id = (params.id || null) as Id<"devBugs"> | null;
    return <ContributionDetailScreen key={params.id} id={id} embedded />;
  }

  return <ContributionDetailScreen />;
}
