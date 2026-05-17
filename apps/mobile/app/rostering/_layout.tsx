import { Stack } from "expo-router";

/**
 * Layout for leader rostering routes
 *
 * Provides stack navigation for:
 * - /rostering/[group_id] - Event list (EventListScreen)
 * - /rostering/[group_id]/event/[plan_id] - Event editor (EventEditorScreen)
 * - /rostering/[group_id]/team/[channel_id] - Team setup (TeamSetupScreen)
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
