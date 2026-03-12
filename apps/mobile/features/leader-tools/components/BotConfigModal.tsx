import React, { useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Switch,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useAuthenticatedQuery, useAuthenticatedMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useAuth } from "@providers/AuthProvider";

type SelectOption = {
  value: string;
  label: string;
};

type ConfigField = {
  key: string;
  label: string;
  type: "text" | "textarea" | "boolean" | "number" | "select" | "leader_select" | "channel_select";
  placeholder?: string;
  helpText?: string;
  options?: SelectOption[];
  showWhen?: { field: string; value: string | string[] };
};

type BotConfigModalProps = {
  visible: boolean;
  onClose: () => void;
  groupId: string;
  botId: string;
  botName: string;
  botIcon: string;
};

export function BotConfigModal({
  visible,
  onClose,
  groupId,
  botId,
  botName,
  botIcon,
}: BotConfigModalProps) {
  const insets = useSafeAreaInsets();
  const { primaryColor } = useCommunityTheme();

  // Fetch current config using Convex
  const enabled = visible && !!groupId && !!botId;
  const configData = useQuery(
    api.functions.groupBots.getConfig,
    enabled ? { groupId: groupId as Id<"groups">, botId } : "skip"
  );
  const isLoading = configData === undefined && enabled;
  const error = null; // Convex throws on error

  // Fetch group data for leader_select fields
  const groupData = useQuery(
    api.functions.groups.index.getById,
    visible && groupId ? { groupId: groupId as Id<"groups"> } : "skip"
  );

  // Fetch channels for channel_select fields
  const channelsData = useAuthenticatedQuery(
    api.functions.messaging.channels.listGroupChannels,
    visible && groupId ? { groupId: groupId as Id<"groups">, includeArchived: true } : "skip"
  );

  // Local state for form values
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [isDirty, setIsDirty] = useState(false);

  // Update form values when config loads
  useEffect(() => {
    if (configData?.config) {
      setFormValues(configData.config);
      setIsDirty(false);
    }
  }, [configData]);

  // Update config mutation using Convex (auto-injects token)
  const updateConfigMutation = useAuthenticatedMutation(api.functions.groupBots.updateConfig);
  const [isSaving, setIsSaving] = useState(false);

  // Wrap mutation with callbacks
  const updateMutation = {
    mutate: async (args: { groupId: string; botId: string; config: Record<string, unknown> }) => {
      setIsSaving(true);
      try {
        await updateConfigMutation({
          groupId: args.groupId as Id<"groups">,
          botId: args.botId,
          config: args.config,
        });
        // Convex auto-updates queries, no invalidation needed
        onClose();
      } catch (err: any) {
        Alert.alert("Error", err?.message || "Failed to save configuration");
      } finally {
        setIsSaving(false);
      }
    },
    isPending: isSaving,
  };

  const handleFieldChange = (key: string, value: unknown) => {
    setFormValues((prev) => {
      if (botId === "birthday" && key === "mode") {
        const nextMode =
          value === "leader_reminder" || value === "general_chat"
            ? value
            : undefined;
        if (!nextMode) {
          return { ...prev, [key]: value };
        }

        const nextValues: Record<string, unknown> = { ...prev, mode: nextMode };
        const currentTargetChannel =
          typeof prev.targetChannelSlug === "string"
            ? prev.targetChannelSlug
            : undefined;

        if (
          nextMode === "leader_reminder" &&
          (!currentTargetChannel || currentTargetChannel === "general")
        ) {
          nextValues.targetChannelSlug = "leaders";
        }

        if (
          nextMode === "general_chat" &&
          (!currentTargetChannel || currentTargetChannel === "leaders")
        ) {
          nextValues.targetChannelSlug = "general";
        }

        return nextValues;
      }

      return { ...prev, [key]: value };
    });
    setIsDirty(true);
  };

  const handleSave = () => {
    updateMutation.mutate({
      groupId,
      botId,
      config: formValues,
    });
  };

  const handleResetToDefault = () => {
    Alert.alert(
      "Reset to Default",
      "Are you sure you want to reset to the default configuration?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: () => {
            if (configData?.defaultConfig) {
              setFormValues(configData.defaultConfig);
              setIsDirty(true);
            }
          },
        },
      ]
    );
  };

  // Check if a field should be visible based on showWhen condition
  const isFieldVisible = (field: ConfigField): boolean => {
    if (!field.showWhen) return true;
    const { field: dependentField, value: expectedValue } = field.showWhen;
    const currentValue = formValues[dependentField];
    if (Array.isArray(expectedValue)) {
      return expectedValue.includes(currentValue as string);
    }
    return currentValue === expectedValue;
  };

  // Get leaders for leader_select dropdown
  // Note: Leaders need to be fetched from groupMembers with leader role
  // For now, use empty array as placeholder - feature needs Convex function update
  const leaders = (groupData as any)?.leaders || [];

  const renderField = (field: ConfigField) => {
    const value = formValues[field.key];

    switch (field.type) {
      case "textarea":
        return (
          <View key={field.key} style={styles.fieldContainer}>
            <Text style={styles.fieldLabel}>{field.label}</Text>
            <TextInput
              style={[styles.input, styles.textareaInput]}
              value={String(value || "")}
              onChangeText={(text) => handleFieldChange(field.key, text)}
              placeholder={field.placeholder}
              placeholderTextColor="#999"
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
            {field.helpText && (
              <Text style={styles.helpText}>{field.helpText}</Text>
            )}
          </View>
        );

      case "boolean":
        return (
          <View key={field.key} style={styles.fieldContainer}>
            <View style={styles.switchRow}>
              <View style={styles.switchLabelContainer}>
                <Text style={styles.fieldLabel}>{field.label}</Text>
                {field.helpText && (
                  <Text style={styles.helpText}>{field.helpText}</Text>
                )}
              </View>
              <Switch
                value={Boolean(value)}
                onValueChange={(val) => handleFieldChange(field.key, val)}
                trackColor={{ false: "#E0E0E0", true: primaryColor }}
                thumbColor={value ? primaryColor : "#f4f3f4"}
              />
            </View>
          </View>
        );

      case "number":
        return (
          <View key={field.key} style={styles.fieldContainer}>
            <Text style={styles.fieldLabel}>{field.label}</Text>
            <TextInput
              style={styles.input}
              value={value !== undefined ? String(value) : ""}
              onChangeText={(text) =>
                handleFieldChange(field.key, text ? Number(text) : undefined)
              }
              placeholder={field.placeholder}
              placeholderTextColor="#999"
              keyboardType="numeric"
            />
            {field.helpText && (
              <Text style={styles.helpText}>{field.helpText}</Text>
            )}
          </View>
        );

      case "select":
        return (
          <View key={field.key} style={styles.fieldContainer}>
            <Text style={styles.fieldLabel}>{field.label}</Text>
            <View style={styles.selectContainer}>
              {field.options?.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.selectOption,
                    value === option.value && styles.selectOptionSelected,
                  ]}
                  onPress={() => handleFieldChange(field.key, option.value)}
                >
                  <Text
                    style={[
                      styles.selectOptionText,
                      value === option.value && styles.selectOptionTextSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {field.helpText && (
              <Text style={styles.helpText}>{field.helpText}</Text>
            )}
          </View>
        );

      case "leader_select":
        return (
          <View key={field.key} style={styles.fieldContainer}>
            <Text style={styles.fieldLabel}>{field.label}</Text>
            <View style={styles.selectContainer}>
              {leaders.map((leader: { id: string; user: { firstName: string; lastName: string } }) => (
                <TouchableOpacity
                  key={leader.id}
                  style={[
                    styles.selectOption,
                    value === leader.id && styles.selectOptionSelected,
                  ]}
                  onPress={() => handleFieldChange(field.key, leader.id)}
                >
                  <Text
                    style={[
                      styles.selectOptionText,
                      value === leader.id && styles.selectOptionTextSelected,
                    ]}
                  >
                    {leader.user.firstName} {leader.user.lastName}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {field.helpText && (
              <Text style={styles.helpText}>{field.helpText}</Text>
            )}
          </View>
        );

      case "channel_select": {
        // Filter to non-archived channels for selection options
        const availableChannels = (channelsData ?? []).filter(
          (ch: { slug: string; name: string; channelType: string; isArchived: boolean }) => !ch.isArchived
        );
        // Check if currently selected channel is archived
        const currentChannel = (channelsData ?? []).find(
          (ch: { slug: string }) => ch.slug === value
        );
        const isSelectedArchived = currentChannel?.isArchived === true;

        return (
          <View key={field.key} style={styles.fieldContainer}>
            <Text style={styles.fieldLabel}>{field.label}</Text>

            {/* Warning banner if selected channel is archived */}
            {isSelectedArchived && (
              <View style={styles.warningBanner}>
                <Ionicons name="warning" size={16} color="#f59e0b" />
                <Text style={styles.warningText}>
                  Selected channel is archived. Bot messages will fail until you select another channel.
                </Text>
              </View>
            )}

            <View style={styles.selectContainer}>
              {availableChannels.map((channel: { slug: string; name: string; channelType: string }) => {
                // Display friendly names for auto channels
                const displayName =
                  channel.channelType === "main"
                    ? "General"
                    : channel.channelType === "leaders"
                      ? "Leaders"
                      : channel.name;

                return (
                  <TouchableOpacity
                    key={channel.slug}
                    style={[
                      styles.selectOption,
                      value === channel.slug && styles.selectOptionSelected,
                    ]}
                    onPress={() => handleFieldChange(field.key, channel.slug)}
                  >
                    <Text
                      style={[
                        styles.selectOptionText,
                        value === channel.slug && styles.selectOptionTextSelected,
                      ]}
                    >
                      {displayName}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {field.helpText && (
              <Text style={styles.helpText}>{field.helpText}</Text>
            )}
          </View>
        );
      }

      case "text":
      default:
        return (
          <View key={field.key} style={styles.fieldContainer}>
            <Text style={styles.fieldLabel}>{field.label}</Text>
            <TextInput
              style={styles.input}
              value={String(value || "")}
              onChangeText={(text) => handleFieldChange(field.key, text)}
              placeholder={field.placeholder}
              placeholderTextColor="#999"
            />
            {field.helpText && (
              <Text style={styles.helpText}>{field.helpText}</Text>
            )}
          </View>
        );
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Ionicons name="close" size={24} color="#333" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerIcon}>{botIcon}</Text>
            <Text style={styles.headerTitle}>{botName} Settings</Text>
          </View>
          <View style={styles.headerRight} />
        </View>

        {/* Content */}
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={primaryColor} />
            <Text style={styles.loadingText}>Loading configuration...</Text>
          </View>
        ) : error ? (
          <View style={styles.errorContainer}>
            <Ionicons name="alert-circle-outline" size={48} color="#e74c3c" />
            <Text style={styles.errorText}>Failed to load configuration</Text>
          </View>
        ) : (
          <>
            <ScrollView
              style={styles.scrollView}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
            >
              {configData?.configFields
                ?.filter((field) => isFieldVisible(field))
                .map((field) => renderField(field))}

              {/* Reset to default button */}
              <TouchableOpacity
                style={styles.resetButton}
                onPress={handleResetToDefault}
              >
                <Ionicons name="refresh-outline" size={18} color="#666" />
                <Text style={styles.resetButtonText}>Reset to default</Text>
              </TouchableOpacity>
            </ScrollView>

            {/* Save button */}
            <View
              style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}
            >
              <TouchableOpacity
                style={[
                  styles.saveButton,
                  (!isDirty || updateMutation.isPending) &&
                    styles.saveButtonDisabled,
                ]}
                onPress={handleSave}
                disabled={!isDirty || updateMutation.isPending}
              >
                {updateMutation.isPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.saveButtonText}>Save Changes</Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  closeButton: {
    padding: 4,
    width: 40,
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  headerIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  headerRight: {
    width: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: "#666",
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  errorText: {
    fontSize: 16,
    color: "#666",
    marginTop: 12,
    textAlign: "center",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  fieldContainer: {
    marginBottom: 20,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: "#333",
  },
  textareaInput: {
    minHeight: 100,
    paddingTop: 12,
  },
  helpText: {
    fontSize: 12,
    color: "#666",
    marginTop: 6,
    fontStyle: "italic",
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  switchLabelContainer: {
    flex: 1,
    marginRight: 12,
  },
  selectContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  selectOption: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  selectOptionSelected: {
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    borderColor: DEFAULT_PRIMARY_COLOR,
  },
  selectOptionText: {
    fontSize: 14,
    color: "#333",
  },
  selectOptionTextSelected: {
    color: "#fff",
    fontWeight: "600",
  },
  warningBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fef3cd",
    borderWidth: 1,
    borderColor: "#ffc107",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    gap: 8,
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    color: "#856404",
    lineHeight: 18,
  },
  resetButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    marginTop: 8,
  },
  resetButtonText: {
    fontSize: 14,
    color: "#666",
    marginLeft: 6,
  },
  footer: {
    padding: 16,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
  },
  saveButton: {
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  saveButtonDisabled: {
    backgroundColor: "#ccc",
  },
  saveButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
