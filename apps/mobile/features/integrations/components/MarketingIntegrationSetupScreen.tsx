/**
 * MarketingIntegrationSetupScreen
 *
 * Shared setup UI for API-key-based marketing platforms (Clearstream, Flodesk).
 * Flow:
 *   1. Admin pastes API key → "Continue"
 *   2. We fetch lists/segments from the platform and show a picker
 *   3. Admin picks destination → "Save"
 * Already-connected state shows status, last sync, destination, and Disconnect.
 *
 * Marketing platforms don't use OAuth and don't need a redirect-callback route.
 */

import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@providers/AuthProvider";
import { Button, Card } from "@components/ui";
import { useTheme } from "@hooks/useTheme";

export interface MarketingIntegrationStatus {
  isConnected: boolean;
  status: string | null;
  lastSyncAt: number | null;
  lastError: string | null;
  destinationId: string | null;
  destinationName: string | null;
  connectedBy: { firstName: string; lastName: string } | null;
}

interface DestinationOption {
  id: string;
  name: string;
}

export interface MarketingIntegrationSetupScreenProps {
  /** Display name e.g. "Clearstream" */
  displayName: string;
  /** Noun for the destination, e.g. "list" or "segment" */
  destinationNoun: string;
  /** One-paragraph description shown above the form */
  description: string;
  /** Status hook result for this platform */
  status: MarketingIntegrationStatus | null;
  isStatusLoading: boolean;
  /** Connect with API key (and optionally a destination) */
  onConnect: (args: {
    apiKey: string;
    destinationId?: string;
    destinationName?: string;
  }) => Promise<unknown>;
  /** Set destination after the fact */
  onSetDestination: (args: {
    destinationId: string;
    destinationName?: string;
  }) => Promise<unknown>;
  /** Fetch destination options from the platform */
  onListDestinations: (apiKey?: string) => Promise<DestinationOption[]>;
  /** Disconnect the integration */
  onDisconnect: () => Promise<unknown>;
}

export function MarketingIntegrationSetupScreen({
  displayName,
  destinationNoun,
  description,
  status,
  isStatusLoading,
  onConnect,
  onSetDestination,
  onListDestinations,
  onDisconnect,
}: MarketingIntegrationSetupScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { colors, isDark } = useTheme();

  const [apiKey, setApiKey] = useState("");
  const [destinations, setDestinations] = useState<DestinationOption[] | null>(
    null,
  );
  const [selectedDestinationId, setSelectedDestinationId] = useState<
    string | null
  >(null);
  const [isLoadingDestinations, setIsLoadingDestinations] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const isAdmin = user?.is_admin === true;
  const isConnected = status?.isConnected ?? false;

  const handleFetchDestinations = async () => {
    if (!apiKey.trim()) {
      Alert.alert("API key required", `Paste your ${displayName} API key first.`);
      return;
    }
    setIsLoadingDestinations(true);
    try {
      // Persist the key in a "pending" state so the action can read it back if
      // the network call needs it; the action also accepts apiKey inline.
      await onConnect({ apiKey: apiKey.trim() });
      const list = await onListDestinations(apiKey.trim());
      setDestinations(list);
      if (list.length > 0 && !selectedDestinationId) {
        setSelectedDestinationId(list[0].id);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert(`${displayName} error`, message);
    } finally {
      setIsLoadingDestinations(false);
    }
  };

  const handleSave = async () => {
    if (!selectedDestinationId) return;
    const selected = destinations?.find((d) => d.id === selectedDestinationId);
    setIsSaving(true);
    try {
      await onSetDestination({
        destinationId: selectedDestinationId,
        destinationName: selected?.name,
      });
      Alert.alert(
        `${displayName} connected`,
        `New community members will now sync to "${selected?.name ?? selectedDestinationId}". Existing members are not backfilled — only new joins and profile edits sync.`,
      );
      router.back();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert(`Could not save`, message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDisconnect = () => {
    Alert.alert(
      `Disconnect ${displayName}`,
      `New members will stop syncing. Existing ${displayName} contacts will not be deleted. You can reconnect anytime.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            try {
              await onDisconnect();
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              Alert.alert("Could not disconnect", message);
            }
          },
        },
      ],
    );
  };

  if (!isAdmin) {
    return (
      <View
        style={[
          styles.container,
          {
            paddingTop: insets.top,
            backgroundColor: colors.backgroundSecondary,
          },
        ]}
      >
        <Header
          title={displayName}
          onBack={() => router.back()}
          textColor={colors.text}
          surfaceColor={colors.surface}
          borderColor={colors.border}
        />
        <View style={styles.centerContainer}>
          <Ionicons
            name="lock-closed-outline"
            size={64}
            color={colors.iconSecondary}
          />
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            Only community admins can manage integrations
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: insets.top,
          backgroundColor: colors.backgroundSecondary,
        },
      ]}
    >
      <Header
        title={displayName}
        onBack={() => router.back()}
        textColor={colors.text}
        surfaceColor={colors.surface}
        borderColor={colors.border}
      />

      <ScrollView style={styles.content}>
        {isStatusLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.text} />
          </View>
        ) : isConnected ? (
          <>
            <Card style={styles.statusCard}>
              <View style={styles.statusHeader}>
                <Ionicons
                  name="checkmark-circle"
                  size={48}
                  color={colors.success}
                />
                <Text style={[styles.statusTitle, { color: colors.text }]}>
                  Connected
                </Text>
              </View>

              {status?.destinationName && (
                <Row
                  label={`Destination ${destinationNoun}`}
                  value={status.destinationName}
                  labelColor={colors.textSecondary}
                  valueColor={colors.text}
                />
              )}
              {status?.connectedBy && (
                <Row
                  label="Connected by"
                  value={`${status.connectedBy.firstName} ${status.connectedBy.lastName}`}
                  labelColor={colors.textSecondary}
                  valueColor={colors.text}
                />
              )}
              {status?.lastSyncAt && (
                <Row
                  label="Last sync"
                  value={new Date(status.lastSyncAt).toLocaleString()}
                  labelColor={colors.textSecondary}
                  valueColor={colors.text}
                />
              )}
              {status?.lastError && (
                <View
                  style={[
                    styles.errorContainer,
                    {
                      backgroundColor: isDark
                        ? "rgba(255,59,48,0.15)"
                        : "#FEF0ED",
                    },
                  ]}
                >
                  <Ionicons name="warning" size={20} color={colors.error} />
                  <Text style={[styles.errorText, { color: colors.error }]}>
                    {status.lastError}
                  </Text>
                </View>
              )}
            </Card>

            <Button
              variant="destructive"
              onPress={handleDisconnect}
              style={styles.button}
            >
              Disconnect {displayName}
            </Button>
          </>
        ) : (
          <>
            <Card style={styles.infoCard}>
              <Text style={[styles.infoTitle, { color: colors.text }]}>
                About {displayName}
              </Text>
              <Text style={[styles.infoText, { color: colors.textSecondary }]}>
                {description}
              </Text>
              <Text style={[styles.infoText, { color: colors.textSecondary }]}>
                Existing members are not backfilled. Only new joins and profile
                edits sync going forward.
              </Text>
            </Card>

            <Card style={styles.formCard}>
              <Text style={[styles.label, { color: colors.text }]}>
                {displayName} API key
              </Text>
              <TextInput
                value={apiKey}
                onChangeText={setApiKey}
                placeholder="Paste API key"
                placeholderTextColor={colors.textSecondary}
                style={[
                  styles.input,
                  {
                    color: colors.text,
                    borderColor: colors.border,
                    backgroundColor: colors.surface,
                  },
                ]}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />

              {destinations === null ? (
                <Button
                  onPress={handleFetchDestinations}
                  disabled={isLoadingDestinations || !apiKey.trim()}
                  style={styles.button}
                >
                  {isLoadingDestinations
                    ? "Loading..."
                    : `Continue → pick ${destinationNoun}`}
                </Button>
              ) : (
                <>
                  <Text
                    style={[
                      styles.label,
                      { color: colors.text, marginTop: 16 },
                    ]}
                  >
                    Destination {destinationNoun}
                  </Text>
                  {destinations.length === 0 ? (
                    <Text
                      style={[
                        styles.infoText,
                        { color: colors.textSecondary },
                      ]}
                    >
                      No {destinationNoun}s found on this account. Create one in{" "}
                      {displayName}, then come back.
                    </Text>
                  ) : (
                    <View style={styles.destinationList}>
                      {destinations.map((d) => {
                        const selected = d.id === selectedDestinationId;
                        return (
                          <TouchableOpacity
                            key={d.id}
                            onPress={() => setSelectedDestinationId(d.id)}
                            style={[
                              styles.destinationRow,
                              {
                                borderColor: selected
                                  ? colors.text
                                  : colors.border,
                                backgroundColor: colors.surface,
                              },
                            ]}
                          >
                            <Ionicons
                              name={
                                selected
                                  ? "radio-button-on"
                                  : "radio-button-off"
                              }
                              size={22}
                              color={
                                selected ? colors.text : colors.iconSecondary
                              }
                            />
                            <Text
                              style={[
                                styles.destinationName,
                                { color: colors.text },
                              ]}
                            >
                              {d.name}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                  <Button
                    onPress={handleSave}
                    disabled={isSaving || !selectedDestinationId}
                    style={styles.button}
                  >
                    {isSaving ? "Saving..." : "Save"}
                  </Button>
                </>
              )}
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Header({
  title,
  onBack,
  textColor,
  surfaceColor,
  borderColor,
}: {
  title: string;
  onBack: () => void;
  textColor: string;
  surfaceColor: string;
  borderColor: string;
}) {
  return (
    <View
      style={[
        styles.header,
        { backgroundColor: surfaceColor, borderBottomColor: borderColor },
      ]}
    >
      <TouchableOpacity onPress={onBack} style={styles.backButton}>
        <Ionicons name="arrow-back" size={24} color={textColor} />
      </TouchableOpacity>
      <Text style={[styles.title, { color: textColor }]}>{title}</Text>
      <View style={styles.placeholder} />
    </View>
  );
}

function Row({
  label,
  value,
  labelColor,
  valueColor,
}: {
  label: string;
  value: string;
  labelColor: string;
  valueColor: string;
}) {
  return (
    <View style={styles.statusRow}>
      <Text style={[styles.statusLabel, { color: labelColor }]}>{label}</Text>
      <Text style={[styles.statusValue, { color: valueColor }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: { padding: 8 },
  title: { fontSize: 17, fontWeight: "600" },
  placeholder: { width: 40 },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
  },
  emptyText: { fontSize: 16, marginTop: 16, textAlign: "center" },
  loadingContainer: { paddingVertical: 40, alignItems: "center" },
  content: { flex: 1, padding: 16 },
  statusCard: { padding: 16, marginBottom: 16 },
  statusHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  statusTitle: { fontSize: 20, fontWeight: "600" },
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  statusLabel: { fontSize: 14 },
  statusValue: { fontSize: 14, fontWeight: "500" },
  errorContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
  },
  errorText: { fontSize: 14, flex: 1 },
  infoCard: { padding: 16, marginBottom: 16 },
  infoTitle: { fontSize: 16, fontWeight: "600", marginBottom: 8 },
  infoText: { fontSize: 14, lineHeight: 20, marginTop: 8 },
  formCard: { padding: 16, marginBottom: 16 },
  label: { fontSize: 14, fontWeight: "600", marginBottom: 8 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  destinationList: { gap: 8, marginTop: 4 },
  destinationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  destinationName: { fontSize: 15, flex: 1 },
  button: { marginTop: 16 },
});
