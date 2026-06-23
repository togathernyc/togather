import { Stack } from "expo-router";

/**
 * Group-scoped rostering navigator.
 *
 * Grid-first IA (Stage 1): the rostering home (`(hub)/index`) renders the
 * roster grid. Teams / Cross-team and the `event` / `team` / `availability`
 * detail screens push over it as plain stack screens. See ADR-024.
 */
export default function RosteringGroupLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
