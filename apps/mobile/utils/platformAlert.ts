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

/** Which button the user picked in {@link chooseAsync}. */
export type Choice = "primary" | "secondary" | "cancel";

/**
 * Imperative two-action prompt ("open the one you have" / "add another" /
 * cancel). Native gets a single three-button `Alert.alert`.
 *
 * Web has no three-way primitive — `window.confirm` is binary — so it asks the
 * primary action first and, only if declined, offers the secondary. Two small
 * dialogs beats inventing a modal here, and each question stays unambiguous.
 * Order the actions so the one a user most often wants is `primary`.
 */
export function chooseAsync(opts: {
  title: string;
  message?: string;
  primaryText: string;
  secondaryText: string;
  cancelText?: string;
}): Promise<Choice> {
  const {
    title,
    message = "",
    primaryText,
    secondaryText,
    cancelText = "Cancel",
  } = opts;

  if (Platform.OS === "web") {
    if (typeof window === "undefined" || !window.confirm) {
      return Promise.resolve("cancel");
    }
    const head = message ? `${title}\n\n${message}` : title;
    if (window.confirm(`${head}\n\n${primaryText}?`)) {
      return Promise.resolve("primary");
    }
    return Promise.resolve(
      window.confirm(`${secondaryText}?`) ? "secondary" : "cancel",
    );
  }

  return new Promise((resolve) => {
    Alert.alert(
      title,
      message || undefined,
      [
        { text: cancelText, style: "cancel", onPress: () => resolve("cancel") },
        { text: secondaryText, onPress: () => resolve("secondary") },
        { text: primaryText, onPress: () => resolve("primary") },
      ],
      { onDismiss: () => resolve("cancel") },
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
