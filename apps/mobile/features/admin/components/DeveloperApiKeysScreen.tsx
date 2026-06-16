/**
 * DeveloperApiKeysScreen - Manage API keys for external integrations
 *
 * Community admins can issue and revoke API keys that let external apps (e.g. an
 * attendance dashboard) call the public attendance API. The raw key is shown
 * exactly once, right after creation, so the admin can copy it.
 *
 * Backend: apps/convex/functions/admin/apiKeys.ts
 * Endpoint: GET <convex-site>/api/v1/attendance (apps/convex/http.ts)
 */
import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { format } from "date-fns";
import * as Clipboard from "expo-clipboard";
import {
  useQuery,
  useAuthenticatedMutation,
  api,
  Id,
} from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { Environment } from "@services/environment";
import { formatError } from "@/utils/error-handling";

const ATTENDANCE_ENDPOINT = `${Environment.getApiBaseUrl()}/api/v1/attendance`;

export function DeveloperApiKeysScreen() {
  const insets = useSafeAreaInsets();
  const { community, token } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const { colors, isDark } = useTheme();

  const communityId = community?.id as Id<"communities"> | undefined;

  const keys = useQuery(
    api.functions.admin.apiKeys.listApiKeys,
    communityId && token ? { token, communityId } : "skip"
  );
  const createKey = useAuthenticatedMutation(
    api.functions.admin.apiKeys.createApiKey
  );
  const revokeKey = useAuthenticatedMutation(
    api.functions.admin.apiKeys.revokeApiKey
  );

  const [newKeyName, setNewKeyName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // The raw key is returned only once, on create. Hold it here so the admin can
  // copy it, then clear it once they dismiss the banner.
  const [createdKey, setCreatedKey] = useState<{ name: string; key: string } | null>(
    null
  );

  const isLoading = keys === undefined;

  const onRefresh = useCallback(() => {
    // useQuery is reactive; this is just to show the spinner briefly.
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 400);
  }, []);

  const handleCreate = useCallback(async () => {
    if (!communityId) return;
    const name = newKeyName.trim();
    if (!name) {
      Alert.alert("Name required", "Give this key a name so you can recognize it later.");
      return;
    }
    setIsCreating(true);
    try {
      const result = await createKey({ communityId, name });
      setCreatedKey({ name: result.name, key: result.key });
      setNewKeyName("");
    } catch (error) {
      Alert.alert("Couldn't create key", formatError(error));
    } finally {
      setIsCreating(false);
    }
  }, [communityId, newKeyName, createKey]);

  const handleCopy = useCallback(async (value: string) => {
    await Clipboard.setStringAsync(value);
    Alert.alert("Copied", "Copied to clipboard.");
  }, []);

  const handleRevoke = useCallback(
    (keyId: Id<"apiKeys">, name: string) => {
      if (!communityId) return;
      Alert.alert(
        "Revoke API key?",
        `"${name}" will stop working immediately. Apps using it will lose access. This can't be undone.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Revoke",
            style: "destructive",
            onPress: async () => {
              try {
                await revokeKey({ communityId, keyId });
              } catch (error) {
                Alert.alert("Couldn't revoke key", formatError(error));
              }
            },
          },
        ]
      );
    },
    [communityId, revokeKey]
  );

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={primaryColor} />
      }
    >
      {/* Endpoint reference */}
      <View style={[styles.section, { backgroundColor: colors.surface }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Attendance API</Text>
        <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>
          Issue an API key to let an external app read this community's group
          attendance data. Pass the key as an{" "}
          <Text style={{ fontWeight: "600" }}>Authorization: Bearer</Text> header.
        </Text>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Endpoint</Text>
        <TouchableOpacity
          style={[styles.codeBox, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
          onPress={() => handleCopy(ATTENDANCE_ENDPOINT)}
        >
          <Text style={[styles.codeText, { color: colors.text }]} numberOfLines={1}>
            GET {ATTENDANCE_ENDPOINT}
          </Text>
          <Ionicons name="copy-outline" size={18} color={colors.textTertiary} />
        </TouchableOpacity>
        <Text style={[styles.hintText, { color: colors.textTertiary }]}>
          Returns aggregate counts only (attended, guests, RSVPs) per event — no
          personal information. Optional filters: since, until, groupType, status, limit.
        </Text>
      </View>

      {/* Newly created key banner (shown once) */}
      {createdKey && (
        <View
          style={[
            styles.section,
            styles.newKeyBanner,
            { backgroundColor: isDark ? "rgba(52,199,89,0.12)" : "#E8F5E9", borderColor: colors.success },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Copy your API key now
          </Text>
          <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>
            This is the only time "{createdKey.name}" will be shown. Store it
            somewhere safe — you won't be able to see it again.
          </Text>
          <TouchableOpacity
            style={[styles.codeBox, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => handleCopy(createdKey.key)}
          >
            <Text style={[styles.codeText, { color: colors.text }]} numberOfLines={1}>
              {createdKey.key}
            </Text>
            <Ionicons name="copy-outline" size={18} color={primaryColor} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: primaryColor }]}
            onPress={() => setCreatedKey(null)}
          >
            <Text style={styles.primaryButtonText}>I've saved it</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Create a new key */}
      <View style={[styles.section, { backgroundColor: colors.surface }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Create API key</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, color: colors.text }]}
          placeholder="Key name (e.g. Attendance Dashboard)"
          placeholderTextColor={colors.textTertiary}
          value={newKeyName}
          onChangeText={setNewKeyName}
          autoCapitalize="words"
          editable={!isCreating}
        />
        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: primaryColor, opacity: isCreating ? 0.6 : 1 }]}
          onPress={handleCreate}
          disabled={isCreating}
        >
          {isCreating ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>Create key</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Existing keys */}
      <View style={[styles.section, { backgroundColor: colors.surface }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>API keys</Text>
        {isLoading ? (
          <ActivityIndicator size="small" color={primaryColor} />
        ) : keys && keys.length > 0 ? (
          <View style={{ gap: 8 }}>
            {keys.map((key) => (
              <View
                key={key.id}
                style={[styles.keyItem, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.keyName, { color: colors.text }]}>{key.name}</Text>
                  <Text style={[styles.keyMeta, { color: colors.textTertiary }]}>
                    {key.keyPrefix}… · Created {format(new Date(key.createdAt), "MMM d, yyyy")}
                  </Text>
                  <Text style={[styles.keyMeta, { color: colors.textTertiary }]}>
                    {key.lastUsedAt
                      ? `Last used ${format(new Date(key.lastUsedAt), "MMM d, yyyy")}`
                      : "Never used"}
                  </Text>
                </View>
                {key.isActive ? (
                  <TouchableOpacity onPress={() => handleRevoke(key.id, key.name)}>
                    <Text style={[styles.revokeText, { color: colors.error }]}>Revoke</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={[styles.revokedBadge, { backgroundColor: isDark ? "rgba(255,59,48,0.15)" : "#FFF0F0" }]}>
                    <Text style={[styles.revokedText, { color: colors.error }]}>Revoked</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        ) : (
          <Text style={[styles.hintText, { color: colors.textTertiary }]}>
            No API keys yet. Create one above to get started.
          </Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  section: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  newKeyBanner: {
    borderWidth: 1,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 6,
  },
  sectionDescription: {
    fontSize: 14,
    marginBottom: 12,
    lineHeight: 20,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    marginBottom: 6,
  },
  codeBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  codeText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "monospace",
  },
  hintText: {
    fontSize: 13,
    lineHeight: 18,
  },
  input: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: 12,
  },
  primaryButton: {
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  keyItem: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
    gap: 12,
  },
  keyName: {
    fontSize: 16,
    fontWeight: "600",
  },
  keyMeta: {
    fontSize: 12,
    marginTop: 2,
  },
  revokeText: {
    fontSize: 14,
    fontWeight: "600",
  },
  revokedBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  revokedText: {
    fontSize: 12,
    fontWeight: "600",
  },
});
