import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { View, Text, StyleSheet } from "react-native";
import { RunSheetToolSettings } from "@features/leader-tools/components/RunSheetToolSettings";
import { FollowupSettingsPanel } from "@features/leader-tools/components/FollowupSettingsPanel";
import type { Id } from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";

export default function ToolSettingsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
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
        return (
          <FollowupSettingsPanel
            groupId={group_id}
            currentColumnOrder={[]}
            currentHiddenColumns={[]}
            columnLabels={{}}
            onColumnChange={() => {}}
            onClose={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace(`/(user)/leader-tools/${group_id}/followup`);
              }
            }}
          />
        );
      case "communication":
        return (
          <View style={[styles.container, { backgroundColor: colors.backgroundSecondary }]}>
            <Text style={[styles.placeholder, { color: colors.textSecondary }]}>
              Communication Bot Settings (Coming Soon)
            </Text>
          </View>
        );
      default:
        return (
          <View style={[styles.container, { backgroundColor: colors.backgroundSecondary }]}>
            <Text style={[styles.placeholder, { color: colors.textSecondary }]}>
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
        return "Follow-up Settings";
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
          headerShown: tool_id !== "followup",
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
  },
  placeholder: {
    fontSize: 16,
    textAlign: "center",
    marginTop: 40,
  },
});
