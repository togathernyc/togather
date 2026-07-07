/**
 * Contribute Conversations Route
 *
 * Route: /dev
 * Conversation list for the contributor dev dashboard (ADR-029 Phase 1.5) —
 * each bug report / idea is a chat with the AI builder. Access gated on the
 * dev-assistant maintainer check.
 *
 * On desktop web (>= 768px) this renders the two-pane split view — persistent
 * conversation sidebar + selected thread — matching the inbox desktop layout.
 * On phones it's the plain conversation list.
 */

import { ContributeListScreen } from "@features/contribute/components/ContributeListScreen";
import { ContributeSplitView } from "@features/contribute/components/ContributeSplitView";
import { useIsDesktopWeb } from "@hooks/useIsDesktopWeb";

export default function ContributeIndexRoute() {
  const isDesktopWeb = useIsDesktopWeb();
  if (isDesktopWeb) return <ContributeSplitView />;
  return <ContributeListScreen />;
}
