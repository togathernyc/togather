/**
 * PlanningCenterSetupScreen - Setup and manage Planning Center integration.
 *
 * Shows connection status and allows admins to connect/disconnect Planning Center.
 * Uses OAuth flow via expo-web-browser for authentication.
 */

import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@providers/AuthProvider";
import { Button, Card } from "@components/ui";
import { useTheme } from "@hooks/useTheme";
import { usePlanningCenterStatus } from "../hooks/useIntegrations";
import {
  usePlanningCenterAuth,
  useDisconnectPlanningCenter,
} from "../hooks/usePlanningCenterAuth";

export function PlanningCenterSetupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { colors, isDark } = useTheme();

  const { data: status, isLoading } = usePlanningCenterStatus();
  const connectMutation = usePlanningCenterAuth();
  const disconnectMutation = useDisconnectPlanningCenter();

  // Only admins can manage integrations
  const isAdmin = user?.is_admin === true;

  const handleConnect = async (forceLogin = false) => {
    try {
      const result = await connectMutation.mutateAsync({ forceLogin });
      // Success alert is shown by the callback route after OAuth completes
      // Only show cancel message if user cancelled
      if (result?.type === "cancel") {
        // User cancelled - no message needed
      }
    } catch (error) {
      // Error handling is done in the mutation
      console.error("Connection failed:", error);
    }
  };

  const handleChangeAccount = () => {
    Alert.alert(
      "Change Account",
      "This will disconnect the current Planning Center account and let you connect a different one.",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Change Account",
          onPress: () => handleConnect(true),
        },
      ]
    );
  };

  const handleDisconnect = () => {
    Alert.alert(
      "Disconnect Planning Center",
      "Are you sure you want to disconnect Planning Center? This will stop syncing groups and events.",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () => disconnectMutation.mutate(),
        },
      ]
    );
  };

  if (!isAdmin) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.backgroundSecondary }]}>
        <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text }]}>Planning Center</Text>
          <View style={styles.placeholder} />
        </View>

        <View style={styles.centerContainer}>
          <Ionicons name="lock-closed-outline" size={64} color={colors.iconSecondary} />
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            Only community admins can manage integrations
          </Text>
        </View>
      </View>
    );
  }

  const isConnected = status?.is_connected ?? false;
  const isTokenExpired = status?.is_token_expired ?? false;

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.backgroundSecondary }]}>
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Planning Center</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.content}>
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.text} />
          </View>
        ) : (
          <>
            {/* Connection Status Card */}
            <Card style={styles.statusCard}>
              <View style={styles.statusHeader}>
                <Ionicons
                  name={
                    isConnected && !isTokenExpired
                      ? "checkmark-circle"
                      : "alert-circle"
                  }
                  size={48}
                  color={
                    isConnected && !isTokenExpired ? colors.success : colors.warning
                  }
                />
                <Text style={[styles.statusTitle, { color: colors.text }]}>
                  {isConnected && !isTokenExpired
                    ? "Connected"
                    : isTokenExpired
                    ? "Token Expired"
                    : "Not Connected"}
                </Text>
              </View>

              {isConnected && status?.connected_by && (
                <View style={styles.statusRow}>
                  <Text style={[styles.statusLabel, { color: colors.textSecondary }]}>Connected as:</Text>
                  <Text style={[styles.statusValue, { color: colors.text }]}>
                    {status.connected_by.firstName} {status.connected_by.lastName}
                  </Text>
                </View>
              )}

              {status?.last_sync_at && (
                <View style={styles.statusRow}>
                  <Text style={[styles.statusLabel, { color: colors.textSecondary }]}>Last Sync:</Text>
                  <Text style={[styles.statusValue, { color: colors.text }]}>
                    {new Date(status.last_sync_at).toLocaleString()}
                  </Text>
                </View>
              )}

              {status?.last_error && (
                <View style={[styles.errorContainer, { backgroundColor: isDark ? 'rgba(255,59,48,0.15)' : '#FEF0ED' }]}>
                  <Ionicons name="warning" size={20} color={colors.error} />
                  <Text style={[styles.errorText, { color: colors.error }]}>{status.last_error}</Text>
                </View>
              )}
            </Card>

            {/* About Planning Center */}
            <Card style={styles.infoCard}>
              <Text style={[styles.infoTitle, { color: colors.text }]}>About Planning Center</Text>
              <Text style={[styles.infoText, { color: colors.textSecondary }]}>
                Connect your Planning Center account to automatically add new
                community members to Planning Center People when they join your
                community in Togather.
              </Text>
              <Text style={[styles.infoText, { color: colors.textSecondary }]}>
                This integration requires admin access to your Planning Center
                organization.
              </Text>
            </Card>

            {/* Action Buttons */}
            <View style={styles.actionContainer}>
              {!isConnected || isTokenExpired ? (
                <Button
                  onPress={() => handleConnect(false)}
                  loading={connectMutation.isPending}
                  disabled={connectMutation.isPending}
                >
                  {isTokenExpired ? "Reconnect Planning Center" : "Connect to Planning Center"}
                </Button>
              ) : (
                <>
                  <Button
                    onPress={handleChangeAccount}
                    variant="secondary"
                    loading={connectMutation.isPending}
                    disabled={connectMutation.isPending || disconnectMutation.isPending}
                    style={styles.changeAccountButton}
                  >
                    Change Account
                  </Button>
                  <Button
                    onPress={handleDisconnect}
                    variant="danger"
                    loading={disconnectMutation.isPending}
                    disabled={connectMutation.isPending || disconnectMutation.isPending}
                  >
                    Disconnect Planning Center
                  </Button>
                </>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backButton: {
    padding: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
  },
  placeholder: {
    width: 40,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  loadingContainer: {
    padding: 40,
    alignItems: "center",
  },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
  },
  emptyText: {
    fontSize: 16,
    marginTop: 16,
    textAlign: "center",
  },
  statusCard: {
    padding: 20,
    marginBottom: 16,
  },
  statusHeader: {
    alignItems: "center",
    marginBottom: 16,
  },
  statusTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginTop: 12,
  },
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  statusLabel: {
    fontSize: 16,
  },
  statusValue: {
    fontSize: 16,
    fontWeight: "500",
  },
  errorContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 16,
    padding: 12,
    borderRadius: 8,
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  infoCard: {
    padding: 20,
    marginBottom: 16,
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 12,
  },
  infoText: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 12,
  },
  actionContainer: {
    marginTop: 8,
    marginBottom: 32,
  },
  changeAccountButton: {
    marginBottom: 12,
  },
});
