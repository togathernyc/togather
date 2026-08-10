import { Stack } from "expo-router";

/**
 * Layout for leader rostering routes
 *
 * Provides stack navigation for:
 * - /rostering/[group_id] - Rostering hub (Schedule / Teams / Cross-team)
 * - /rostering/[group_id]/event/[plan_id] - Event editor (EventEditorScreen)
 * - /rostering/[group_id]/team/new - Create-team flow (TeamCreateScreen)
 * - /rostering/[group_id]/team/[team_id] - Team detail (TeamSetupScreen)
 */
export default function RosteringLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    />
  );
}
