import { Slot } from "expo-router";

/**
 * Rostering home layout.
 *
 * Grid-first IA (Stage 1): the roster grid is the rostering home and renders
 * its own header, so this layout is now a bare pass-through. The old hub
 * chrome (shared "Rostering" header + JS top tab bar) is gone — Teams and
 * Cross-team are reached from the grid's ⋯ overflow and render their own
 * back headers. The `(hub)` route group itself is removed in a later cleanup
 * stage. See ADR-024.
 */
export default function RosteringHomeLayout() {
  return <Slot />;
}
