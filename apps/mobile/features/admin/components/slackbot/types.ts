import { Alert, Platform } from "react-native";
import type { useSlackBotConfig } from "../../hooks/useSlackBotConfig";

/** The loaded slackBotConfig row as the admin screen sees it. */
export type SlackBotConfig = NonNullable<ReturnType<typeof useSlackBotConfig>["config"]>;

/** Ask before a destructive change — `Alert` buttons don't render on web, so fall back to confirm(). */
export function confirmDestructive(title: string, message: string, onConfirm: () => void) {
  if (Platform.OS === "web") {
    if (window.confirm(message)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    { text: "Remove", style: "destructive", onPress: onConfirm },
  ]);
}

/** Surface a failed save — same web caveat as confirmDestructive. */
export function showError(message: string) {
  if (Platform.OS === "web") {
    window.alert(message);
  } else {
    Alert.alert("Error", message);
  }
}
