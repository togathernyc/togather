/**
 * Integrations list route.
 * Shows all available integrations with their connection status.
 */

import { View } from "react-native";
import { IntegrationsScreen } from "@features/integrations/components/IntegrationsScreen";
import { DragHandle } from "@components/ui/DragHandle";

export default function IntegrationsRoute() {
  return (
    <View style={{ flex: 1 }}>
      <DragHandle />
      <IntegrationsScreen />
    </View>
  );
}
