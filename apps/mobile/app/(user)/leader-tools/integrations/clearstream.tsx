/**
 * Clearstream setup route.
 * Allows admins to connect/disconnect Clearstream marketing SMS integration.
 */

import { View } from "react-native";
import { ClearstreamSetupScreen } from "@features/integrations/components/ClearstreamSetupScreen";
import { DragHandle } from "@components/ui/DragHandle";

export default function ClearstreamRoute() {
  return (
    <View style={{ flex: 1 }}>
      <DragHandle />
      <ClearstreamSetupScreen />
    </View>
  );
}
