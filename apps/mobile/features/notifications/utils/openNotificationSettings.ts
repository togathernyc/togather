/**
 * Open the system notification settings for this app.
 *
 * Cross-platform best-effort:
 *  - Android: deep-links directly to the per-app notification settings page
 *    via `expo-intent-launcher` and `ACTION_APP_NOTIFICATION_SETTINGS`. Falls
 *    back to `Linking.openSettings()` (which lands on app info — 1–2 extra
 *    taps) if the intent fails.
 *  - iOS: uses `Linking.openSettings()`, which opens the app's Settings page.
 *    Notifications is typically the first row there, one tap away. We don't
 *    use the unofficial `app-settings:notification` URL scheme — it's not
 *    documented by Apple and has been a source of App Store rejections.
 */
import { Linking, Platform } from "react-native";
import Constants from "expo-constants";
import * as IntentLauncher from "expo-intent-launcher";

export async function openNotificationSettings(): Promise<void> {
  if (Platform.OS === "android") {
    const bundleId = Constants.expoConfig?.android?.package;
    if (bundleId) {
      try {
        await IntentLauncher.startActivityAsync(
          "android.settings.APP_NOTIFICATION_SETTINGS",
          {
            extra: { "android.provider.extra.APP_PACKAGE": bundleId },
          },
        );
        return;
      } catch (error) {
        console.warn(
          "[openNotificationSettings] APP_NOTIFICATION_SETTINGS intent failed, falling back:",
          error,
        );
      }
    }
    // Fallback: app info page.
    await Linking.openSettings();
    return;
  }

  // iOS (and any other platform): documented Apple-approved path.
  await Linking.openSettings();
}
