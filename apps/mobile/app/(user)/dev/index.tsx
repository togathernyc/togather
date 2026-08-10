/**
 * Contribute Conversations Route
 *
 * Route: /dev
 * Conversation list for the contributor dev dashboard (ADR-029 Phase 1.5) —
 * each bug report / idea is a chat with the AI builder. Access gated on the
 * dev-assistant maintainer check.
 *
 * On phones this IS the list screen. On desktop web (>= 768px) the persistent
 * conversation sidebar lives in the layout (app/(user)/dev/_layout.tsx), so this
 * route only renders the right pane — the "nothing selected yet" placeholder.
 */

import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ContributeListScreen } from "@features/contribute/components/ContributeListScreen";
import { useIsDesktopWeb } from "@hooks/useIsDesktopWeb";
import { useTheme } from "@hooks/useTheme";

export default function ContributeIndexRoute() {
  const isDesktopWeb = useIsDesktopWeb();
  const { colors } = useTheme();

  if (isDesktopWeb) {
    return (
      <View
        style={[styles.placeholder, { backgroundColor: colors.backgroundSecondary }]}
      >
        <Ionicons
          name="chatbubbles-outline"
          size={48}
          color={colors.iconSecondary}
        />
        <Text style={[styles.placeholderText, { color: colors.textTertiary }]}>
          Select a conversation
        </Text>
      </View>
    );
  }

  return <ContributeListScreen />;
}

const styles = StyleSheet.create({
  placeholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  placeholderText: {
    marginTop: 12,
    fontSize: 16,
  },
});
