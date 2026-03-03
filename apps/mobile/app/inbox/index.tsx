import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ChatInboxScreen } from "@features/chat/components/ChatInboxScreen";
import { useIsDesktopWeb } from "../../hooks/useIsDesktopWeb";

/**
 * On desktop web, this renders a placeholder in the right panel
 * (the sidebar already shows the conversation list and auto-selects the first one).
 * On mobile, this renders the full inbox screen.
 */
export default function InboxIndex() {
  const isDesktopWeb = useIsDesktopWeb();

  if (isDesktopWeb) {
    return (
      <View style={styles.placeholder}>
        <Ionicons name="chatbubbles-outline" size={48} color="#D1D5DB" />
        <Text style={styles.placeholderText}>Select a conversation</Text>
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
    backgroundColor: "#FAFAFA",
  },
  placeholderText: {
    marginTop: 12,
    fontSize: 16,
    color: "#9CA3AF",
  },
});
