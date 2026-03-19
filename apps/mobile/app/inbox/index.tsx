import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ChatInboxScreen } from "@features/chat/components/ChatInboxScreen";
import { useIsDesktopWeb } from "../../hooks/useIsDesktopWeb";
import { useTheme } from "@hooks/useTheme";

/**
 * On desktop web, this renders a placeholder in the right panel
 * (the sidebar already shows the conversation list and auto-selects the first one).
 * On mobile, this renders the full inbox screen.
 */
export default function InboxIndex() {
  const isDesktopWeb = useIsDesktopWeb();
  const { colors } = useTheme();

  if (isDesktopWeb) {
    return (
      <View style={[styles.placeholder, { backgroundColor: colors.backgroundSecondary }]}>
        <Ionicons name="chatbubbles-outline" size={48} color={colors.iconSecondary} />
        <Text style={[styles.placeholderText, { color: colors.textTertiary }]}>Select a conversation</Text>
      </View>
    );
  }

  return <ChatInboxScreen />;
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
