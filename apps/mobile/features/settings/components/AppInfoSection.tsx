/**
 * App Info Section
 *
 * Displays app version and last update information.
 * Helps users verify they have the latest OTA update.
 * Includes option to send debug logs to developers.
 */
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  Linking,
  Share,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { logCollector } from "@utils/logCollector";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { Environment } from "@services/environment";
import { useDevToolsEscapeHatch } from "@hooks/useDevToolsEscapeHatch";

const DEVELOPER_EMAIL = "togather@supa.media";

/**
 * Format a date to a readable string
 */
function formatDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) {
    return "Just now";
  } else if (diffMins < 60) {
    return `${diffMins} minute${diffMins === 1 ? "" : "s"} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  } else {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
}

/**
 * Collect device and app info for debugging
 */
function getDeviceInfo(): string {
  const appVersion = Constants.expoConfig?.version || "unknown";
  const runtimeVersion =
    typeof Constants.expoConfig?.runtimeVersion === "string"
      ? Constants.expoConfig.runtimeVersion
      : "unknown";
  const otaVersion = Constants.expoConfig?.extra?.otaVersion || appVersion;
  const updateId = Updates.updateId || "none";
  const createdAt = Updates.createdAt
    ? Updates.createdAt.toISOString()
    : "none";
  const isEmbedded = Updates.isEmbeddedLaunch;

  return `
=== DEVICE INFO ===
Platform: ${Platform.OS} ${Platform.Version}
App Version: ${appVersion}
OTA Version: ${otaVersion}
Runtime Version: ${runtimeVersion}
Update ID: ${updateId}
Update Created: ${createdAt}
Is Embedded: ${isEmbedded}
Is Dev: ${__DEV__}
Timestamp: ${new Date().toISOString()}
==================

`;
}

export function AppInfoSection() {
  const [isSending, setIsSending] = useState(false);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const { handleVersionTap, tapCount, isEnabled: devToolsEnabled } = useDevToolsEscapeHatch();

  const appVersion = Constants.expoConfig?.version || "1.0.0";
  const currentEnv = Environment.current;
  const runtimeVersion =
    typeof Constants.expoConfig?.runtimeVersion === "string"
      ? Constants.expoConfig.runtimeVersion
      : "unknown";
  const otaVersion = Constants.expoConfig?.extra?.otaVersion || appVersion;

  // Get update info from expo-updates
  const isEmbedded = Updates.isEmbeddedLaunch;
  const updateId = Updates.updateId;
  const createdAt = Updates.createdAt;

  // Determine update status
  let updateStatus: string;
  let updateTime: string | null = null;

  if (__DEV__) {
    updateStatus = "Development build";
  } else if (isEmbedded) {
    updateStatus = "Embedded (no OTA updates)";
  } else if (createdAt) {
    updateStatus = "OTA update installed";
    updateTime = formatDate(createdAt);
  } else {
    updateStatus = "Unknown";
  }

  const handleCheckForUpdates = async () => {
    if (__DEV__) {
      Alert.alert(
        "Development Mode",
        "OTA updates are not available in development mode.",
        [{ text: "OK" }]
      );
      return;
    }

    setIsCheckingUpdate(true);
    try {
      const update = await Updates.checkForUpdateAsync();

      if (update.isAvailable) {
        setUpdateAvailable(true);
        Alert.alert(
          "Update Available",
          "A new version is available. Would you like to download and install it now?",
          [
            { text: "Later", style: "cancel" },
            {
              text: "Update Now",
              onPress: async () => {
                try {
                  await Updates.fetchUpdateAsync();
                  Alert.alert(
                    "Update Downloaded",
                    "The app will now restart to apply the update.",
                    [
                      {
                        text: "Restart",
                        onPress: () => Updates.reloadAsync(),
                      },
                    ]
                  );
                } catch (fetchError) {
                  console.error("Failed to fetch update:", fetchError);
                  Alert.alert(
                    "Update Failed",
                    "Could not download the update. Please try again later.",
                    [{ text: "OK" }]
                  );
                }
              },
            },
          ]
        );
      } else {
        Alert.alert(
          "Up to Date",
          "You're running the latest version of the app.",
          [{ text: "OK" }]
        );
      }
    } catch (error) {
      console.error("Failed to check for updates:", error);
      Alert.alert(
        "Check Failed",
        "Could not check for updates. Please try again later.",
        [{ text: "OK" }]
      );
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleSendLogs = async () => {
    setIsSending(true);

    try {
      // Collect logs and device info
      const deviceInfo = getDeviceInfo();
      const logs = logCollector.getLogsAsString();
      const logCount = logCollector.getCount();

      const body = `${deviceInfo}=== CONSOLE LOGS (${logCount} entries) ===

${logs || "No logs captured yet. Try reproducing the issue first."}`;

      const subject = `[Togather Debug Logs] ${new Date().toLocaleDateString()}`;

      // Try to share via the system share sheet first (works better on iOS)
      // This allows users to choose their preferred method: email, notes, messages, etc.
      try {
        await Share.share({
          title: subject,
          message: `${subject}\n\n${body}`,
        });
      } catch (shareError) {
        // If share fails, try mailto link as fallback
        const mailtoUrl = `mailto:${DEVELOPER_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        const canOpen = await Linking.canOpenURL(mailtoUrl);

        if (canOpen) {
          await Linking.openURL(mailtoUrl);
        } else {
          Alert.alert(
            "Cannot Send Logs",
            "Please set up an email account or share app to send logs.",
            [{ text: "OK" }]
          );
        }
      }
    } catch (error) {
      console.error("Failed to send logs:", error);
      Alert.alert(
        "Failed to Send",
        "Could not prepare logs for sharing. Please try again.",
        [{ text: "OK" }]
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>App Info</Text>

      {/* Version row - tappable for dev tools escape hatch */}
      <TouchableOpacity
        style={styles.infoRow}
        onPress={handleVersionTap}
        activeOpacity={0.7}
      >
        <View style={styles.infoLabel}>
          <Ionicons name="phone-portrait-outline" size={18} color="#666" />
          <Text style={styles.labelText}>Version</Text>
        </View>
        <View style={styles.versionContainer}>
          <Text style={styles.infoValue}>{otaVersion}</Text>
          {/* Show tap progress indicator when user starts tapping */}
          {tapCount > 0 && tapCount < 5 && (
            <Text style={styles.tapIndicator}>
              {".".repeat(tapCount)}
            </Text>
          )}
          {/* Show indicator when dev tools are enabled via escape hatch */}
          {devToolsEnabled && !__DEV__ && (
            <Ionicons name="construct" size={14} color="#FF9500" style={styles.devIcon} />
          )}
        </View>
      </TouchableOpacity>

      {/* Environment indicator */}
      <View style={styles.infoRow}>
        <View style={styles.infoLabel}>
          <Ionicons name="server-outline" size={18} color="#666" />
          <Text style={styles.labelText}>Environment</Text>
        </View>
        <View style={styles.envBadge}>
          <View
            style={[
              styles.envIndicator,
              currentEnv.name === "staging"
                ? styles.envIndicatorStaging
                : styles.envIndicatorProduction,
            ]}
          />
          <Text style={styles.infoValue}>{currentEnv.displayName}</Text>
        </View>
      </View>

      <View style={styles.infoRow}>
        <View style={styles.infoLabel}>
          <Ionicons name="cloud-download-outline" size={18} color="#666" />
          <Text style={styles.labelText}>Update Status</Text>
        </View>
        <Text style={styles.infoValue}>{updateStatus}</Text>
      </View>

      {updateTime && (
        <View style={styles.infoRow}>
          <View style={styles.infoLabel}>
            <Ionicons name="time-outline" size={18} color="#666" />
            <Text style={styles.labelText}>Last Updated</Text>
          </View>
          <Text style={styles.infoValue}>{updateTime}</Text>
        </View>
      )}

      {updateId && !__DEV__ && (
        <View style={styles.infoRow}>
          <View style={styles.infoLabel}>
            <Ionicons name="finger-print-outline" size={18} color="#666" />
            <Text style={styles.labelText}>Update ID</Text>
          </View>
          <Text style={[styles.infoValue, styles.updateId]}>
            {updateId.substring(0, 8)}...
          </Text>
        </View>
      )}

      {/* Check for Updates Button */}
      <TouchableOpacity
        style={[
          styles.checkUpdateButton,
          updateAvailable && styles.checkUpdateButtonHighlight,
        ]}
        onPress={handleCheckForUpdates}
        disabled={isCheckingUpdate}
        activeOpacity={0.7}
      >
        {isCheckingUpdate ? (
          <ActivityIndicator size="small" color={DEFAULT_PRIMARY_COLOR} />
        ) : (
          <>
            <Ionicons
              name={updateAvailable ? "download-outline" : "refresh-outline"}
              size={20}
              color={DEFAULT_PRIMARY_COLOR}
            />
            <Text style={styles.checkUpdateButtonText}>
              {updateAvailable ? "Update Available" : "Check for Updates"}
            </Text>
          </>
        )}
      </TouchableOpacity>

      {/* Send Logs Button */}
      <TouchableOpacity
        style={styles.sendLogsButton}
        onPress={handleSendLogs}
        disabled={isSending}
        activeOpacity={0.7}
      >
        {isSending ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <>
            <Ionicons name="bug-outline" size={20} color="#fff" />
            <Text style={styles.sendLogsButtonText}>Send Logs to Developer</Text>
          </>
        )}
      </TouchableOpacity>

      <Text style={styles.logsHint}>
        Experiencing issues? Send logs to help us debug.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 12,
    backgroundColor: "#fff",
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  infoLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  labelText: {
    fontSize: 15,
    color: "#666",
  },
  infoValue: {
    fontSize: 15,
    color: "#333",
    fontWeight: "500",
  },
  versionContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  tapIndicator: {
    fontSize: 18,
    color: "#999",
    letterSpacing: 2,
    marginLeft: 4,
  },
  devIcon: {
    marginLeft: 6,
  },
  updateId: {
    fontFamily: "monospace",
    fontSize: 13,
    color: "#666",
  },
  checkUpdateButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f5f0ff",
    borderRadius: 8,
    padding: 14,
    marginTop: 20,
    gap: 8,
    borderWidth: 1,
    borderColor: "#e0d4f7",
  },
  checkUpdateButtonHighlight: {
    backgroundColor: "#ede5ff",
    borderColor: DEFAULT_PRIMARY_COLOR,
  },
  checkUpdateButtonText: {
    color: DEFAULT_PRIMARY_COLOR,
    fontSize: 16,
    fontWeight: "600",
  },
  sendLogsButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    borderRadius: 8,
    padding: 14,
    marginTop: 20,
    gap: 8,
  },
  sendLogsButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  logsHint: {
    fontSize: 12,
    color: "#999",
    textAlign: "center",
    marginTop: 8,
  },
  envBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  envIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  envIndicatorProduction: {
    backgroundColor: "#34C759",
  },
  envIndicatorStaging: {
    backgroundColor: "#FF9500",
  },
});
