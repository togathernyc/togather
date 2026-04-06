/**
 * BroadcastComposer - Create and configure a targeted broadcast
 *
 * Flow: Select target → Preview count → Write content → Test on self → Submit for approval
 */

import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Switch,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuthenticatedQuery, useAuthenticatedMutation, useAuthenticatedAction, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";

const TARGET_OPTIONS = [
  { value: "all_users", label: "All Users" },
  { value: "new_users", label: "New Users (last 30 days)" },
  { value: "no_profile_pic", label: "Users Without Profile Picture" },
  { value: "no_group_of_type", label: "Users Not in a Group Type" },
  { value: "leaders_no_group_image", label: "Leaders Without Group Image" },
];

const DEEP_LINK_PRESETS: Record<string, Array<{ value: string; label: string }>> = {
  default: [
    { value: "", label: "None" },
    { value: "/profile/edit", label: "Edit Profile" },
    { value: "/(tabs)/search?view=groups", label: "Browse Groups" },
    { value: "/(tabs)/search?view=events", label: "Browse Events" },
  ],
  no_profile_pic: [
    { value: "/profile/edit", label: "Edit Profile (recommended)" },
    { value: "", label: "None" },
    { value: "/(tabs)/search?view=groups", label: "Browse Groups" },
  ],
  no_group_of_type: [
    { value: "/(tabs)/search?view=groups", label: "Browse Groups (recommended)" },
    { value: "", label: "None" },
    { value: "/(tabs)/search?view=events", label: "Browse Events" },
  ],
  leaders_no_group_image: [
    { value: "per_user_group", label: "Open Their Group (auto-resolved)" },
    { value: "", label: "None" },
    { value: "/(tabs)/search?view=groups", label: "Browse Groups" },
  ],
};

interface BroadcastComposerProps {
  communityId: Id<"communities">;
  onBack: () => void;
  onCreated: () => void;
}

export function BroadcastComposer({
  communityId,
  onBack,
  onCreated,
}: BroadcastComposerProps) {
  const { colors } = useTheme();
  const [targetType, setTargetType] = useState("all_users");
  const [groupTypeSlug, setGroupTypeSlug] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pushEnabled, setPushEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [deepLink, setDeepLink] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [createdBroadcastId, setCreatedBroadcastId] = useState<string | null>(null);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  const targetCriteria = {
    type: targetType,
    ...(targetType === "no_group_of_type" && groupTypeSlug ? { groupTypeSlug } : {}),
    ...(targetType === "new_users" ? { daysThreshold: 30 } : {}),
  };

  // Fetch group types for dropdown
  const groupTypes = useAuthenticatedQuery(
    api.functions.adminBroadcasts.listGroupTypes,
    { communityId }
  );

  // Preview targeting — action (not reactive query)
  const previewTargetingAction = useAuthenticatedAction(api.functions.adminBroadcasts.previewTargeting);

  const createBroadcast = useAuthenticatedMutation(api.functions.adminBroadcasts.create);
  const sendTestToSelf = useAuthenticatedMutation(api.functions.adminBroadcasts.sendTestToSelf);
  const requestApproval = useAuthenticatedMutation(api.functions.adminBroadcasts.requestApproval);

  // Refresh preview when criteria changes
  useEffect(() => {
    let cancelled = false;
    setIsLoadingPreview(true);
    setPreviewCount(null);

    // Don't preview if no_group_of_type is selected but no slug chosen
    if (targetType === "no_group_of_type" && !groupTypeSlug) {
      setIsLoadingPreview(false);
      setPreviewCount(0);
      return;
    }

    previewTargetingAction({ communityId, targetCriteria })
      .then((result) => {
        if (!cancelled) {
          setPreviewCount(result.count);
          setIsLoadingPreview(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPreviewCount(null);
          setIsLoadingPreview(false);
        }
      });

    return () => { cancelled = true; };
  }, [targetType, groupTypeSlug]);

  const channels = [
    ...(pushEnabled ? ["push"] : []),
    ...(emailEnabled ? ["email"] : []),
    ...(smsEnabled ? ["sms"] : []),
  ];

  const handleCreate = async () => {
    if (!title.trim() || !body.trim()) {
      Alert.alert("Missing Fields", "Please enter a title and message body.");
      return;
    }
    if (channels.length === 0) {
      Alert.alert("No Channel", "Select at least one notification channel.");
      return;
    }

    setIsCreating(true);
    try {
      const result = await createBroadcast({
        communityId,
        targetCriteria,
        title: title.trim(),
        body: body.trim(),
        channels,
        deepLink: deepLink || undefined,
      });
      setCreatedBroadcastId(result.id);
      Alert.alert(
        "Broadcast Created",
        "Target count is being calculated. Send a test to yourself or submit for approval."
      );
    } catch (error) {
      Alert.alert("Error", "Failed to create broadcast.");
      console.error("Create broadcast error:", error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleTestSend = async () => {
    if (!createdBroadcastId) return;
    setIsTesting(true);
    try {
      await sendTestToSelf({
        broadcastId: createdBroadcastId as Id<"adminBroadcasts">,
      });
      Alert.alert("Test Sent", "Check your notifications for the test message.");
    } catch (error) {
      Alert.alert("Error", "Failed to send test.");
      console.error("Test send error:", error);
    } finally {
      setIsTesting(false);
    }
  };

  const handleRequestApproval = async () => {
    if (!createdBroadcastId) return;
    Alert.alert(
      "Submit for Approval",
      `This will notify other admins. ${previewCount ?? "?"} users will be targeted.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Submit",
          onPress: async () => {
            try {
              await requestApproval({
                broadcastId: createdBroadcastId as Id<"adminBroadcasts">,
              });
              Alert.alert("Submitted", "Another admin must approve before sending.");
              onCreated();
            } catch (error) {
              Alert.alert("Error", "Failed to submit for approval.");
              console.error("Request approval error:", error);
            }
          },
        },
      ]
    );
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}
      contentContainerStyle={styles.contentContainer}
      keyboardShouldPersistTaps="handled"
    >
      {/* Back Button */}
      <TouchableOpacity style={styles.backRow} onPress={onBack}>
        <Ionicons name="arrow-back" size={20} color={DEFAULT_PRIMARY_COLOR} />
        <Text style={[styles.backText, { color: DEFAULT_PRIMARY_COLOR }]}>Back</Text>
      </TouchableOpacity>

      <Text style={[styles.heading, { color: colors.text }]}>New Broadcast</Text>

      {/* Target Selection */}
      <Text style={[styles.label, { color: colors.textSecondary }]}>TARGET AUDIENCE</Text>
      {TARGET_OPTIONS.map((opt) => (
        <TouchableOpacity
          key={opt.value}
          style={[
            styles.optionRow,
            { backgroundColor: colors.surface, borderColor: targetType === opt.value ? DEFAULT_PRIMARY_COLOR : colors.border },
            targetType === opt.value && styles.optionRowSelected,
          ]}
          onPress={() => {
            setTargetType(opt.value);
            if (opt.value !== "no_group_of_type") setGroupTypeSlug("");
            // Auto-select recommended deep link for this target
            const presets = DEEP_LINK_PRESETS[opt.value] || DEEP_LINK_PRESETS.default;
            setDeepLink(presets[0].value);
          }}
        >
          <Text style={[styles.optionLabel, { color: colors.text }]}>{opt.label}</Text>
          {targetType === opt.value && (
            <Ionicons name="checkmark-circle" size={20} color={DEFAULT_PRIMARY_COLOR} />
          )}
        </TouchableOpacity>
      ))}

      {/* Group type picker (dropdown style) */}
      {targetType === "no_group_of_type" && (
        <View style={styles.subOptions}>
          <Text style={[styles.subLabel, { color: colors.textSecondary }]}>Select group type:</Text>
          {groupTypes ? (
            groupTypes.map((gt) => (
              <TouchableOpacity
                key={gt.slug}
                style={[
                  styles.optionRow,
                  { backgroundColor: colors.surface, borderColor: groupTypeSlug === gt.slug ? DEFAULT_PRIMARY_COLOR : colors.border },
                  groupTypeSlug === gt.slug && styles.optionRowSelected,
                ]}
                onPress={() => setGroupTypeSlug(gt.slug)}
              >
                <Text style={[styles.optionLabel, { color: colors.text }]}>{gt.name}</Text>
                {groupTypeSlug === gt.slug && (
                  <Ionicons name="checkmark-circle" size={20} color={DEFAULT_PRIMARY_COLOR} />
                )}
              </TouchableOpacity>
            ))
          ) : (
            <ActivityIndicator size="small" color={colors.textSecondary} />
          )}
        </View>
      )}

      {/* Preview Count */}
      <View style={[styles.previewCard, { backgroundColor: colors.surface }]}>
        <Ionicons name="people-outline" size={20} color={colors.textSecondary} />
        <Text style={[styles.previewText, { color: colors.text }]}>
          {isLoadingPreview
            ? "Calculating..."
            : previewCount !== null
              ? `${previewCount} users will receive this`
              : "Select a target to preview"}
        </Text>
      </View>

      {/* Content */}
      <Text style={[styles.label, { color: colors.textSecondary, marginTop: 20 }]}>CONTENT</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
        placeholder="Notification title"
        placeholderTextColor={colors.textSecondary}
        value={title}
        onChangeText={setTitle}
        maxLength={100}
      />
      <TextInput
        style={[styles.input, styles.textArea, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
        placeholder="Message body"
        placeholderTextColor={colors.textSecondary}
        value={body}
        onChangeText={setBody}
        multiline
        maxLength={500}
        textAlignVertical="top"
      />

      {/* Channels */}
      <Text style={[styles.label, { color: colors.textSecondary, marginTop: 20 }]}>CHANNELS</Text>
      <View style={[styles.channelRow, { backgroundColor: colors.surface }]}>
        <Text style={[styles.channelLabel, { color: colors.text }]}>Push Notification</Text>
        <Switch value={pushEnabled} onValueChange={setPushEnabled} trackColor={{ false: colors.border, true: DEFAULT_PRIMARY_COLOR }} />
      </View>
      <View style={[styles.channelRow, { backgroundColor: colors.surface }]}>
        <Text style={[styles.channelLabel, { color: colors.text }]}>Email</Text>
        <Switch value={emailEnabled} onValueChange={setEmailEnabled} trackColor={{ false: colors.border, true: DEFAULT_PRIMARY_COLOR }} />
      </View>
      {/* SMS is only available for event blasts, not admin broadcasts */}

      {/* Deep Link */}
      <Text style={[styles.label, { color: colors.textSecondary, marginTop: 20 }]}>TAP ACTION</Text>
      {(DEEP_LINK_PRESETS[targetType] || DEEP_LINK_PRESETS.default).map((preset) => (
        <TouchableOpacity
          key={preset.value}
          style={[
            styles.optionRow,
            { backgroundColor: colors.surface, borderColor: deepLink === preset.value ? DEFAULT_PRIMARY_COLOR : colors.border },
            deepLink === preset.value && styles.optionRowSelected,
          ]}
          onPress={() => setDeepLink(preset.value)}
        >
          <Text style={[styles.optionLabel, { color: colors.text }]}>{preset.label}</Text>
          {deepLink === preset.value && (
            <Ionicons name="checkmark-circle" size={20} color={DEFAULT_PRIMARY_COLOR} />
          )}
        </TouchableOpacity>
      ))}

      {/* Actions */}
      {!createdBroadcastId ? (
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: DEFAULT_PRIMARY_COLOR }]}
          onPress={handleCreate}
          disabled={isCreating}
        >
          {isCreating ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.actionButtonText}>Create Broadcast</Text>
          )}
        </TouchableOpacity>
      ) : (
        <View style={styles.actionGroup}>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.surface, borderWidth: 1, borderColor: DEFAULT_PRIMARY_COLOR }]}
            onPress={handleTestSend}
            disabled={isTesting}
          >
            {isTesting ? (
              <ActivityIndicator color={DEFAULT_PRIMARY_COLOR} />
            ) : (
              <Text style={[styles.actionButtonText, { color: DEFAULT_PRIMARY_COLOR }]}>
                Send Test to Myself
              </Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: DEFAULT_PRIMARY_COLOR }]}
            onPress={handleRequestApproval}
          >
            <Text style={styles.actionButtonText}>Submit for Approval</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 40,
  },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 12,
  },
  backText: {
    fontSize: 16,
  },
  heading: {
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 20,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    marginBottom: 8,
  },
  subLabel: {
    fontSize: 13,
    marginBottom: 6,
  },
  subOptions: {
    marginLeft: 12,
    marginBottom: 4,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 6,
  },
  optionRowSelected: {
    borderWidth: 2,
  },
  optionLabel: {
    fontSize: 15,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    marginBottom: 8,
  },
  textArea: {
    minHeight: 80,
  },
  previewCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderRadius: 10,
    marginTop: 8,
  },
  previewText: {
    fontSize: 15,
    fontWeight: "500",
  },
  channelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
    borderRadius: 10,
    marginBottom: 6,
  },
  channelLabel: {
    fontSize: 16,
  },
  actionButton: {
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    marginTop: 20,
  },
  actionButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  actionGroup: {
    gap: 8,
  },
});
