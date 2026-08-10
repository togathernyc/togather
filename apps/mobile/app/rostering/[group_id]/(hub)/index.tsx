import { RosterGridScreen } from "@features/scheduling";

/**
 * Rostering home — route `/rostering/[group_id]`.
 *
 * Grid-first IA (Stage 1): the roster grid is the rostering home. It renders
 * its own header and hosts Teams / Cross-team / Collect availability in a ⋯
 * overflow. The old Schedule list (EventListScreen) is no longer the home.
 */
export default function RosteringHome() {
  return <RosterGridScreen />;
}
