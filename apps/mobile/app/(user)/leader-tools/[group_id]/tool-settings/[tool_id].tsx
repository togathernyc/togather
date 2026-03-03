import { Stack, useLocalSearchParams } from "expo-router";
import { View, Text, StyleSheet } from "react-native";
import { RunSheetToolSettings } from "@features/leader-tools/components/RunSheetToolSettings";
import { FollowupScoreSettings } from "@features/leader-tools/components/FollowupScoreSettings";
import type { Id } from "@services/api/convex";

export default function ToolSettingsScreen() {
  const { group_id, tool_id } = useLocalSearchParams<{
    group_id: string;
    tool_id: string;
  }>();

  // Route to appropriate settings component based on tool_id
  const renderToolSettings = () => {
    switch (tool_id) {
      case "runsheet":
        return <RunSheetToolSettings groupId={group_id as Id<"groups">} />;
      case "followup":
        return <FollowupScoreSettings groupId={group_id as Id<"groups">} />;
      case "communication":
        return (
          <View style={styles.container}>
            <Text style={styles.placeholder}>
              Communication Bot Settings (Coming Soon)
            </Text>
          </View>
        );
      default:
        return (
          <View style={styles.container}>
            <Text style={styles.placeholder}>
              No settings available for this tool
            </Text>
          </View>
        );
    }
  };

  // Get tool title for header
  const getToolTitle = () => {
    switch (tool_id) {
      case "runsheet":
        return "Run Sheet Settings";
      case "followup":
        return "Follow-up Score Settings";
      case "communication":
        return "Communication Settings";
      default:
        return "Tool Settings";
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: getToolTitle(),
          headerShown: true,
        }}
      />
      {renderToolSettings()}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: "#f8f9fa",
  },
  placeholder: {
    fontSize: 16,
    textAlign: "center",
    marginTop: 40,
    color: "#666",
  },
});
