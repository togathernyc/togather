/**
 * AutoChannelSettings - Settings modal for PCO Auto Channels.
 *
 * Allows group leaders to view and edit auto channel configuration:
 * - View current PCO config (service type, teams, timing)
 * - Edit the configuration
 * - Toggle syncing on/off
 * - View sync status
 * - Trigger manual sync
 *
 * Access Control:
 * - Only group leaders can edit settings
 * - Other members can view status but not edit
 */
import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Switch,
  Text,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useAction, api } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { formatDistanceToNow } from "date-fns";
import type { Id } from "@services/api/convex";
import { PcoAutoChannelConfig, type AutoChannelConfig } from "./PcoAutoChannelConfig";

interface AutoChannelSettingsProps {
  channelId: Id<"chatChannels">;
  groupId: Id<"groups">;
  communityId: Id<"communities">;
  canEdit: boolean;
  onClose: () => void;
}

export function AutoChannelSettings({
  channelId,
  groupId,
  communityId,
  canEdit,
  onClose,
}: AutoChannelSettingsProps) {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const { colors, isDark } = useTheme();

  // State
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [editedConfig, setEditedConfig] = useState<AutoChannelConfig | null>(null);

  // Query for auto channel config
  const config = useQuery(
    api.functions.pcoServices.queries.getAutoChannelConfigByChannel,
    token ? { token, channelId } : "skip"
  );

  // Mutations
  const updateConfig = useMutation(
    api.functions.messaging.channels.updateAutoChannelConfig
  );
  const disableAutoChannel = useMutation(
    api.functions.messaging.channels.disableAutoChannel
  );

  // Actions
  const triggerSync = useAction(
    api.functions.pcoServices.actions.triggerChannelSync
  );

  // Initialize edited config when entering edit mode
  useEffect(() => {
    if (isEditing && config?.config) {
      setEditedConfig({
        // Include filters if present (new format)
        filters: config.config.filters,
        // Legacy fields
        serviceTypeId: config.config.serviceTypeId || "",
        serviceTypeName: config.config.serviceTypeName || "",
        syncScope: (config.config.syncScope as "all_teams" | "single_team" | "multi_team") || "all_teams",
        teamIds: config.config.teamIds,
        teamNames: config.config.teamNames,
        addMembersDaysBefore: config.config.addMembersDaysBefore,
        removeMembersDaysAfter: config.config.removeMembersDaysAfter,
      });
    }
  }, [isEditing, config]);

  const handleSave = useCallback(async () => {
    if (!token || !editedConfig) return;

    setIsSaving(true);
    try {
      await updateConfig({
        token,
        channelId,
        config: {
          // Include filters if present (new format takes precedence in sync logic)
          filters: editedConfig.filters,
          // Legacy fields for backward compatibility
          serviceTypeId: editedConfig.serviceTypeId,
          serviceTypeName: editedConfig.serviceTypeName,
          syncScope: editedConfig.syncScope,
          teamIds: editedConfig.teamIds,
          teamNames: editedConfig.teamNames,
          addMembersDaysBefore: editedConfig.addMembersDaysBefore,
          removeMembersDaysAfter: editedConfig.removeMembersDaysAfter,
        },
      });
      setIsEditing(false);
      Alert.alert("Success", "Auto channel settings updated.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save settings";
      Alert.alert("Error", message);
    } finally {
      setIsSaving(false);
    }
  }, [token, channelId, editedConfig, updateConfig]);

  const handleToggleActive = useCallback(async (value: boolean) => {
    if (!token) return;

    try {
      if (value) {
        // Re-enable
        await updateConfig({
          token,
          channelId,
          config: {},
          isActive: true,
        });
      } else {
        // Disable with confirmation
        Alert.alert(
          "Disable Sync",
          "Are you sure you want to disable auto-syncing? Members will no longer be automatically added or removed based on PCO schedules.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Disable",
              style: "destructive",
              onPress: async () => {
                await disableAutoChannel({ token, channelId });
              },
            },
          ]
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update settings";
      Alert.alert("Error", message);
    }
  }, [token, channelId, updateConfig, disableAutoChannel]);

  const handleSync = useCallback(async () => {
    if (!token) return;
    setIsSyncing(true);
    try {
      const result = await triggerSync({ token, channelId });
      if (result.status === "success") {
        Alert.alert(
          "Sync Complete",
          `Added ${result.addedCount || 0} members, removed ${result.removedCount || 0} members.`
        );
      } else if (result.status === "no_upcoming_plans") {
        Alert.alert("No Plans", result.reason || "No upcoming plans found to sync.");
      } else {
        Alert.alert("Sync Complete", "Channel membership has been synced.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to sync channel";
      Alert.alert("Error", message);
    } finally {
      setIsSyncing(false);
    }
  }, [token, channelId, triggerSync]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditedConfig(null);
  }, []);

  // Loading state
  if (!config) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Auto Channel Settings</Text>
          <View style={styles.headerRight} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading settings...</Text>
        </View>
      </View>
    );
  }

  const pcoConfig = config.config;
  const isActive = config.isActive;
  const statusColor = config.lastSyncStatus === "success" ? colors.success : colors.error;
  const lastSyncText = config.lastSyncAt
    ? `Last synced ${formatDistanceToNow(config.lastSyncAt, { addSuffix: true })}`
    : "Never synced";

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Ionicons name="close" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Auto Channel Settings</Text>
        {canEdit && !isEditing ? (
          <TouchableOpacity
            onPress={() => setIsEditing(true)}
            style={styles.editButton}
          >
            <Text style={[styles.editButtonText, { color: primaryColor }]}>
              Edit
            </Text>
          </TouchableOpacity>
        ) : isEditing ? (
          <View style={styles.editActions}>
            <TouchableOpacity onPress={handleCancelEdit} style={styles.cancelButton}>
              <Text style={[styles.cancelButtonText, { color: colors.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSave}
              style={styles.saveButton}
              disabled={isSaving}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color={primaryColor} />
              ) : (
                <Text style={[styles.saveButtonText, { color: primaryColor }]}>
                  Save
                </Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.headerRight} />
        )}
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Sync Status Section */}
        <View style={[styles.section, { backgroundColor: colors.surfaceSecondary }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Sync Status</Text>

          <View style={styles.statusRow}>
            <View style={styles.statusInfo}>
              <View style={styles.statusIndicator}>
                <View style={[styles.statusDot, { backgroundColor: isActive ? colors.success : colors.textTertiary }]} />
                <Text style={[styles.statusLabel, { color: colors.text }]}>
                  {isActive ? "Active" : "Disabled"}
                </Text>
              </View>
              <Text style={[styles.statusSubtext, { color: colors.textSecondary }]}>
                {isActive
                  ? "Membership is being synced from Planning Center"
                  : "Syncing is disabled for this channel"}
              </Text>
            </View>
            {canEdit && (
              <Switch
                value={isActive}
                onValueChange={handleToggleActive}
                trackColor={{ false: colors.border, true: `${primaryColor}80` }}
                thumbColor={isActive ? primaryColor : colors.surfaceSecondary}
              />
            )}
          </View>

          <View style={[styles.lastSyncRow, { borderTopColor: colors.border }]}>
            <View style={styles.lastSyncInfo}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <Text style={[styles.lastSyncText, { color: colors.textSecondary }]}>{lastSyncText}</Text>
            </View>
            {config.lastSyncError && (
              <Text style={[styles.errorText, { color: colors.error }]}>{config.lastSyncError}</Text>
            )}
          </View>

          {config.currentEventDate && (
            <View style={styles.currentEventRow}>
              <Ionicons name="calendar-outline" size={16} color={colors.textSecondary} />
              <Text style={[styles.currentEventText, { color: colors.textSecondary }]}>
                Current service: {new Date(config.currentEventDate).toLocaleDateString()}
              </Text>
            </View>
          )}

          {/* Sync Results */}
          {config.lastSyncResults && (
            <View style={[styles.syncResultsRow, { borderTopColor: colors.border }]}>
              <View style={styles.syncResultsHeader}>
                <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                <Text style={[styles.syncResultsText, { color: colors.success }]}>
                  {config.lastSyncResults.matchedCount} matched
                </Text>
                {config.lastSyncResults.unmatchedCount > 0 && (
                  <>
                    <Ionicons name="alert-circle" size={16} color={colors.warning} style={{ marginLeft: 12 }} />
                    <Text style={[styles.syncResultsText, { color: colors.warning }]}>
                      {config.lastSyncResults.unmatchedCount} unmatched
                    </Text>
                  </>
                )}
              </View>
            </View>
          )}

          {/* Unmatched People Details */}
          {config.lastSyncResults?.unmatchedPeople && config.lastSyncResults.unmatchedPeople.length > 0 && (
            <View style={[styles.unmatchedSection, { backgroundColor: isDark ? '#332b00' : '#FFF8E6' }]}>
              <Text style={[styles.unmatchedTitle, { color: isDark ? '#FFD60A' : '#B25000' }]}>People not found in Togather:</Text>
              {config.lastSyncResults.unmatchedPeople.map((person, index) => (
                <View key={person.pcoPersonId} style={[
                  styles.unmatchedPerson,
                  { borderBottomColor: isDark ? '#554400' : '#FFE0A3' },
                  index === config.lastSyncResults!.unmatchedPeople!.length - 1 && { borderBottomWidth: 0 }
                ]}>
                  <View style={styles.unmatchedPersonInfo}>
                    <Text style={[styles.unmatchedName, { color: colors.text }]}>{person.pcoName}</Text>
                    {person.pcoPhone && (
                      <Text style={[styles.unmatchedContact, { color: colors.textSecondary }]}>📞 {person.pcoPhone}</Text>
                    )}
                    {person.pcoEmail && (
                      <Text style={[styles.unmatchedContact, { color: colors.textSecondary }]}>✉️ {person.pcoEmail}</Text>
                    )}
                  </View>
                  <View style={[styles.unmatchedReasonBadge, { backgroundColor: colors.warning }]}>
                    <Text style={styles.unmatchedReasonText}>
                      {person.reason === "not_in_group" ? "Not in group" :
                       person.reason === "not_in_community" ? "Not in community" :
                       person.reason === "no_contact_info" ? "No contact info in PCO" :
                       person.reason === "phone_mismatch" ? "Phone not found" :
                       person.reason === "email_mismatch" ? "Email not found" : "Unknown"}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Sync Now Button */}
          {isActive && (
            <TouchableOpacity
              style={[styles.syncButton, { borderColor: primaryColor }]}
              onPress={handleSync}
              disabled={isSyncing}
            >
              {isSyncing ? (
                <ActivityIndicator size="small" color={primaryColor} />
              ) : (
                <>
                  <Ionicons name="sync" size={16} color={primaryColor} />
                  <Text style={[styles.syncButtonText, { color: primaryColor }]}>
                    Sync Now
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* Configuration Section */}
        <View style={[styles.section, { backgroundColor: colors.surfaceSecondary }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Configuration</Text>

          {isEditing && editedConfig ? (
            <PcoAutoChannelConfig
              key={`edit-${config?._id}`}
              communityId={communityId}
              onChange={setEditedConfig}
              initialConfig={editedConfig}
            />
          ) : (
            <View style={styles.configDisplay}>
              {/* Service Types - prefer filter-based, fall back to legacy */}
              <View style={[styles.configItem, { borderBottomColor: colors.borderLight }]}>
                <Text style={[styles.configLabel, { color: colors.textSecondary }]}>Service Types</Text>
                <Text style={[styles.configValue, { color: colors.text }]}>
                  {pcoConfig.filters?.serviceTypeNames?.length
                    ? pcoConfig.filters.serviceTypeNames.join(", ")
                    : pcoConfig.serviceTypeName || "Not set"}
                </Text>
              </View>

              {/* Teams */}
              <View style={[styles.configItem, { borderBottomColor: colors.borderLight }]}>
                <Text style={[styles.configLabel, { color: colors.textSecondary }]}>Teams</Text>
                <Text style={[styles.configValue, { color: colors.text }]}>
                  {pcoConfig.syncScope === "all_teams"
                    ? "All Teams"
                    : pcoConfig.filters?.teamNames?.length
                      ? pcoConfig.filters.teamNames.join(", ")
                      : pcoConfig.teamNames?.join(", ") || "Selected teams"}
                </Text>
              </View>

              {/* Positions */}
              <View style={[styles.configItem, { borderBottomColor: colors.borderLight }]}>
                <Text style={[styles.configLabel, { color: colors.textSecondary }]}>Positions</Text>
                <Text style={[styles.configValue, { color: colors.text }]}>
                  {pcoConfig.filters?.positions?.length
                    ? pcoConfig.filters.positions
                        .map((p) => {
                          if (typeof p === "string") return p;
                          // For object positions, show displayable name with context
                          if (p.serviceTypeName && p.teamName) {
                            return `${p.serviceTypeName} > ${p.teamName} > ${p.name}`;
                          }
                          if (p.teamName) {
                            return `${p.teamName} > ${p.name}`;
                          }
                          return p.name;
                        })
                        .join(", ")
                    : "All positions"}
                </Text>
              </View>

              <View style={[styles.configItem, { borderBottomColor: colors.borderLight }]}>
                <Text style={[styles.configLabel, { color: colors.textSecondary }]}>Add Members</Text>
                <Text style={[styles.configValue, { color: colors.text }]}>
                  {pcoConfig.addMembersDaysBefore} days before service
                </Text>
              </View>

              <View style={[styles.configItem, { borderBottomColor: colors.borderLight }]}>
                <Text style={[styles.configLabel, { color: colors.textSecondary }]}>Remove Members</Text>
                <Text style={[styles.configValue, { color: colors.text }]}>
                  {pcoConfig.removeMembersDaysAfter} days after service
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* Info Section */}
        <View style={[styles.infoSection, { backgroundColor: isDark ? '#1a2730' : '#F0F7FF' }]}>
          <Ionicons name="information-circle-outline" size={20} color={colors.textSecondary} />
          <Text style={[styles.infoText, { color: colors.textSecondary }]}>
            This channel automatically syncs members from Planning Center Services.
            Members scheduled for upcoming services will be added, and removed after
            the service ends based on the timing settings above.
          </Text>
        </View>
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
  closeButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "flex-start",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  headerRight: {
    width: 60,
  },
  editButton: {
    width: 60,
    alignItems: "flex-end",
  },
  editButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  editActions: {
    flexDirection: "row",
    gap: 12,
  },
  cancelButton: {
    padding: 4,
  },
  cancelButtonText: {
    fontSize: 16,
  },
  saveButton: {
    padding: 4,
    minWidth: 40,
    alignItems: "center",
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  section: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 16,
  },
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  statusInfo: {
    flex: 1,
    marginRight: 12,
  },
  statusIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusLabel: {
    fontSize: 15,
    fontWeight: "600",
  },
  statusSubtext: {
    fontSize: 13,
    marginLeft: 16,
  },
  lastSyncRow: {
    marginBottom: 12,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  lastSyncInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  lastSyncText: {
    fontSize: 13,
  },
  errorText: {
    fontSize: 12,
    marginTop: 4,
    marginLeft: 16,
  },
  currentEventRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  currentEventText: {
    fontSize: 13,
  },
  syncButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
  },
  syncButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  configDisplay: {
    gap: 12,
  },
  configItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  configLabel: {
    fontSize: 14,
    flex: 1,
  },
  configValue: {
    fontSize: 14,
    fontWeight: "500",
    flex: 1,
    textAlign: "right",
  },
  infoSection: {
    flexDirection: "row",
    gap: 12,
    padding: 16,
    borderRadius: 12,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  syncResultsRow: {
    marginBottom: 12,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  syncResultsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  syncResultsText: {
    fontSize: 13,
    fontWeight: "500",
  },
  unmatchedSection: {
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  unmatchedTitle: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
  },
  unmatchedPerson: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  unmatchedPersonInfo: {
    flex: 1,
    marginRight: 8,
  },
  unmatchedName: {
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 2,
  },
  unmatchedContact: {
    fontSize: 12,
    marginTop: 2,
  },
  unmatchedReasonBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  unmatchedReasonText: {
    fontSize: 11,
    fontWeight: "500",
    color: "#fff",
  },
});
