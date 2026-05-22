import { Stack } from "expo-router";

/**
 * Group-scoped rostering navigator.
 *
 * The `(hub)` route group is the tabbed Rostering hub (Schedule / Teams /
 * Cross-team); `event` and `team` detail screens push over it as plain
 * stack screens. See ADR-024.
 */
export default function RosteringGroupLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
