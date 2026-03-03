/**
 * Planning Center setup route.
 * Allows admins to connect/disconnect Planning Center integration.
 */

import { View } from "react-native";
import { PlanningCenterSetupScreen } from "@features/integrations/components/PlanningCenterSetupScreen";
import { DragHandle } from "@components/ui/DragHandle";

export default function PlanningCenterRoute() {
  return (
    <View style={{ flex: 1 }}>
      <DragHandle />
      <PlanningCenterSetupScreen />
    </View>
  );
}
