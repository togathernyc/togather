/**
 * Cross-platform confirm / notice helpers.
 *
 * React Native's `Alert.alert` is a **no-op on web** in this codebase, so any
 * confirm built on it (Cancel/Delete buttons) silently does nothing on web —
 * the action never runs. These helpers fall back to `window.confirm` /
 * `window.alert` on web and use `Alert.alert` on native, matching the inline
 * pattern already used in `HostsPicker` / `EventPageClient`.
 */
import { Alert, Platform } from "react-native";

/**
 * Imperative confirm. Resolves `true` if the user confirms, `false` if they
 * cancel or dismiss. Works on web (window.confirm) and native (Alert.alert).
 */
export function confirmAsync(opts: {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  /** iOS shows the confirm button in red; ignored on web. */
  destructive?: boolean;
}): Promise<boolean> {
  const {
    title,
    message = "",
    confirmText = "OK",
    cancelText = "Cancel",
    destructive = false,
  } = opts;

  if (Platform.OS === "web") {
    if (typeof window === "undefined" || !window.confirm) {
      return Promise.resolve(false);
    }
    return Promise.resolve(window.confirm(message ? `${title}\n\n${message}` : title));
  }

  return new Promise((resolve) => {
    Alert.alert(
      title,
      message || undefined,
      [
        { text: cancelText, style: "cancel", onPress: () => resolve(false) },
        {
          text: confirmText,
          style: destructive ? "destructive" : "default",
          onPress: () => resolve(true),
        },
      ],
      { onDismiss: () => resolve(false) },
    );
  });
}

/**
 * One-button informational / error notice. Web uses window.alert (Alert.alert
 * is a no-op there), so a failure message isn't swallowed silently.
 */
export function notify(title: string, message?: string): void {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && window.alert) {
      window.alert(message ? `${title}\n\n${message}` : title);
    }
    return;
  }
  Alert.alert(title, message);
}
