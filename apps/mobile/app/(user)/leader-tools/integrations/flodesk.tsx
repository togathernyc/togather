/**
 * Flodesk setup route.
 * Allows admins to connect/disconnect Flodesk marketing email integration.
 */

import { View } from "react-native";
import { FlodeskSetupScreen } from "@features/integrations/components/FlodeskSetupScreen";
import { DragHandle } from "@components/ui/DragHandle";

export default function FlodeskRoute() {
  return (
    <View style={{ flex: 1 }}>
      <DragHandle />
      <FlodeskSetupScreen />
    </View>
  );
}
