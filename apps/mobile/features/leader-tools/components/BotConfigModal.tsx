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
import { useTheme } from "@hooks/useTheme";

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
  const { colors, isDark } = useTheme();
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

  // Warning banner colors (semantic)
  const warningBannerBg = isDark ? '#3a3520' : '#fef3cd';
  const warningBorderColor = isDark ? '#FF9F0A' : '#ffc107';
  const warningTextColor = isDark ? '#FF9F0A' : '#856404';

  const renderField = (field: ConfigField) => {
    const value = formValues[field.key];

    switch (field.type) {
      case "textarea":
        return (
          <View key={field.key} style={styles.fieldContainer}>
            <Text style={[styles.fieldLabel, { color: colors.text }]}>{field.label}</Text>
            <TextInput
              style={[styles.input, styles.textareaInput, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.text }]}
              value={String(value || "")}
              onChangeText={(text) => handleFieldChange(field.key, text)}
              placeholder={field.placeholder}
              placeholderTextColor={colors.textTertiary}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
            {field.helpText && (
              <Text style={[styles.helpText, { color: colors.textSecondary }]}>{field.helpText}</Text>
            )}
          </View>
        );

      case "boolean":
        return (
          <View key={field.key} style={styles.fieldContainer}>
            <View style={[styles.switchRow, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }]}>
              <View style={styles.switchLabelContainer}>
                <Text style={[styles.fieldLabel, { color: colors.text }]}>{field.label}</Text>
                {field.helpText && (
                  <Text style={[styles.helpText, { color: colors.textSecondary }]}>{field.helpText}</Text>
                )}
              </View>
              <Switch
                value={Boolean(value)}
                onValueChange={(val) => handleFieldChange(field.key, val)}
                trackColor={{ false: colors.border, true: primaryColor }}
                thumbColor={value ? primaryColor : colors.surfaceSecondary}
              />
            </View>
          </View>
        );

      case "number":
        return (
          <View key={field.key} style={styles.fieldContainer}>
            <Text style={[styles.fieldLabel, { color: colors.text }]}>{field.label}</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.text }]}
              value={value !== undefined ? String(value) : ""}
              onChangeText={(text) =>
                handleFieldChange(field.key, text ? Number(text) : undefined)
              }
              placeholder={field.placeholder}
              placeholderTextColor={colors.textTertiary}
              keyboardType="numeric"
            />
            {field.helpText && (
              <Text style={[styles.helpText, { color: colors.textSecondary }]}>{field.helpText}</Text>
            )}
          </View>
        );

      case "select":
        return (
          <View key={field.key} style={styles.fieldContainer}>
            <Text style={[styles.fieldLabel, { color: colors.text }]}>{field.label}</Text>
            <View style={styles.selectContainer}>
              {field.options?.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.selectOption,
                    { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder },
                    value === option.value && { backgroundColor: primaryColor, borderColor: primaryColor },
                  ]}
                  onPress={() => handleFieldChange(field.key, option.value)}
                >
                  <Text
                    style={[
                      styles.selectOptionText,
                      { color: colors.text },
                      value === option.value && { color: colors.textInverse, fontWeight: "600" as const },
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {field.helpText && (
              <Text style={[styles.helpText, { color: colors.textSecondary }]}>{field.helpText}</Text>
            )}
          </View>
        );

      case "leader_select":
        return (
          <View key={field.key} style={styles.fieldContainer}>
            <Text style={[styles.fieldLabel, { color: colors.text }]}>{field.label}</Text>
            <View style={styles.selectContainer}>
              {leaders.map((leader: { id: string; user: { firstName: string; lastName: string } }) => (
                <TouchableOpacity
                  key={leader.id}
                  style={[
                    styles.selectOption,
                    { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder },
                    value === leader.id && { backgroundColor: primaryColor, borderColor: primaryColor },
                  ]}
                  onPress={() => handleFieldChange(field.key, leader.id)}
                >
                  <Text
                    style={[
                      styles.selectOptionText,
                      { color: colors.text },
                      value === leader.id && { color: colors.textInverse, fontWeight: "600" as const },
                    ]}
                  >
                    {leader.user.firstName} {leader.user.lastName}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {field.helpText && (
              <Text style={[styles.helpText, { color: colors.textSecondary }]}>{field.helpText}</Text>
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
            <Text style={[styles.fieldLabel, { color: colors.text }]}>{field.label}</Text>

            {/* Warning banner if selected channel is archived */}
            {isSelectedArchived && (
              <View style={[styles.warningBanner, { backgroundColor: warningBannerBg, borderColor: warningBorderColor }]}>
                <Ionicons name="warning" size={16} color={colors.warning} />
                <Text style={[styles.warningText, { color: warningTextColor }]}>
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
                      { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder },
                      value === channel.slug && { backgroundColor: primaryColor, borderColor: primaryColor },
                    ]}
                    onPress={() => handleFieldChange(field.key, channel.slug)}
                  >
                    <Text
                      style={[
                        styles.selectOptionText,
                        { color: colors.text },
                        value === channel.slug && { color: colors.textInverse, fontWeight: "600" as const },
                      ]}
                    >
                      {displayName}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {field.helpText && (
              <Text style={[styles.helpText, { color: colors.textSecondary }]}>{field.helpText}</Text>
            )}
          </View>
        );
      }

      case "text":
      default:
        return (
          <View key={field.key} style={styles.fieldContainer}>
            <Text style={[styles.fieldLabel, { color: colors.text }]}>{field.label}</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.text }]}
              value={String(value || "")}
              onChangeText={(text) => handleFieldChange(field.key, text)}
              placeholder={field.placeholder}
              placeholderTextColor={colors.textTertiary}
            />
            {field.helpText && (
              <Text style={[styles.helpText, { color: colors.textSecondary }]}>{field.helpText}</Text>
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
        style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerIcon}>{botIcon}</Text>
            <Text style={[styles.headerTitle, { color: colors.text }]}>{botName} Settings</Text>
          </View>
          <View style={styles.headerRight} />
        </View>

        {/* Content */}
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={primaryColor} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading configuration...</Text>
          </View>
        ) : error ? (
          <View style={styles.errorContainer}>
            <Ionicons name="alert-circle-outline" size={48} color={colors.destructive} />
            <Text style={[styles.errorText, { color: colors.textSecondary }]}>Failed to load configuration</Text>
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
                <Ionicons name="refresh-outline" size={18} color={colors.textSecondary} />
                <Text style={[styles.resetButtonText, { color: colors.textSecondary }]}>Reset to default</Text>
              </TouchableOpacity>
            </ScrollView>

            {/* Save button */}
            <View
              style={[styles.footer, { paddingBottom: insets.bottom + 16, backgroundColor: colors.surface, borderTopColor: colors.border }]}
            >
              <TouchableOpacity
                style={[
                  styles.saveButton,
                  { backgroundColor: primaryColor },
                  (!isDirty || updateMutation.isPending) &&
                    { backgroundColor: colors.buttonDisabled },
                ]}
                onPress={handleSave}
                disabled={!isDirty || updateMutation.isPending}
              >
                {updateMutation.isPending ? (
                  <ActivityIndicator size="small" color={colors.textInverse} />
                ) : (
                  <Text style={[styles.saveButtonText, { color: colors.textInverse }]}>Save Changes</Text>
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
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
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
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  errorText: {
    fontSize: 16,
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
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  textareaInput: {
    minHeight: 100,
    paddingTop: 12,
  },
  helpText: {
    fontSize: 12,
    marginTop: 6,
    fontStyle: "italic",
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
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
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  selectOptionText: {
    fontSize: 14,
  },
  warningBanner: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    gap: 8,
  },
  warningText: {
    flex: 1,
    fontSize: 13,
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
    marginLeft: 6,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
  },
  saveButton: {
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
