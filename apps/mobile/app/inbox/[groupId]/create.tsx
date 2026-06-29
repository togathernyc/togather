/**
 * Channel Creation Route
 *
 * Route: /inbox/[groupId]/create
 *
 * Allows group leaders to create custom channels with manual membership management,
 * or auto channels synced with Planning Center Services.
 * Creates the channel and navigates to it on success.
 */
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Button } from "@components/ui";
import { Toast } from "@components/ui/Toast";
import { useAuthenticatedMutation, api, useQuery } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { PcoAutoChannelConfig, type AutoChannelConfig } from "@features/channels";
import {
  CrossTeamSelectorPicker,
  createCrossTeamChannelRef,
  type CrossTeamSelector,
} from "@features/scheduling";
import type { Id } from "@services/api/convex";

type ChannelType = "custom" | "pco_services" | "cross_team";

const MAX_NAME_LENGTH = 50;

export default function CreateChannelScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { token, community, user } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const { colors, isDark } = useTheme();

  // Check if user is a community admin (required for creating PCO channels)
  const isCommunityAdmin = user?.is_admin ?? false;

  // Get group to verify communityId (for PCO config)
  const group = useQuery(
    api.functions.groups.index.getById,
    groupId && token
      ? { groupId: groupId as Id<"groups">, token }
      : "skip"
  );

  // Channel type state
  const [channelType, setChannelType] = useState<ChannelType>("custom");
  const [autoConfig, setAutoConfig] = useState<AutoChannelConfig | null>(null);
  // Cross-team channel: the auto-sync selectors chosen by the leader.
  const [crossTeamSelectors, setCrossTeamSelectors] = useState<
    CrossTeamSelector[]
  >([]);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [joinMode, setJoinMode] = useState<"open" | "approval_required">("open");
  const [isLoading, setIsLoading] = useState(false);

  // Toast state
  const [toast, setToast] = useState<{
    visible: boolean;
    message: string;
    type: "error" | "success" | "info" | "warning";
  }>({
    visible: false,
    message: "",
    type: "error",
  });

  // Mutations
  const createCustomChannel = useAuthenticatedMutation(
    api.functions.messaging.channels.createCustomChannel
  );
  const createAutoChannel = useAuthenticatedMutation(
    api.functions.messaging.channels.createAutoChannel
  );
  const createCrossTeamChannel = useAuthenticatedMutation(
    createCrossTeamChannelRef
  );

  // Get communityId from group or fallback to auth context
  const communityId = group?.communityId || (community?.id as Id<"communities"> | undefined);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(`/inbox/${groupId}/general`);
    }
  };

  const handleNameChange = (text: string) => {
    // Limit input to max length
    if (text.length <= MAX_NAME_LENGTH) {
      setName(text);
    }
  };

  const isNameValid = name.trim().length > 0;
  // PCO channels also require autoConfig; cross-team channels require at least
  // one selector; custom + team need only a name.
  const canCreate =
    isNameValid &&
    !isLoading &&
    (channelType !== "pco_services" || autoConfig !== null) &&
    (channelType !== "cross_team" || crossTeamSelectors.length > 0);

  const handleCreate = async () => {
    if (!canCreate) return;

    setIsLoading(true);

    try {
      if (channelType === "pco_services") {
        // PCO auto channel
        if (!autoConfig) {
          throw new Error("Planning Center configuration is required");
        }
        const result = await createAutoChannel({
          groupId: groupId as Id<"groups">,
          name: name.trim(),
          description: description.trim() || undefined,
          integrationType: "pco_services",
          autoChannelConfig: autoConfig,
        });
        router.replace(`/inbox/${groupId}/${result.slug}`);
        return;
      }

      if (channelType === "cross_team") {
        // Cross-team channel — membership is auto-synced from event-plan role
        // assignments across the chosen serving teams. No creator/manual
        // membership; navigate to the channel like a custom channel.
        const result = await createCrossTeamChannel({
          groupId: groupId as Id<"groups">,
          name: name.trim(),
          description: description.trim() || undefined,
          selectors: crossTeamSelectors,
        });
        router.replace(`/inbox/${groupId}/${result.slug}`);
        return;
      }

      // Custom channel. Serving teams are no longer created here — they get
      // their own create flow in the Rostering hub (ADR-024 / ADR-025), which
      // calls `createServingTeam` and provisions the team's chat channel as
      // part of that flow.
      const result = await createCustomChannel({
        groupId: groupId as Id<"groups">,
        name: name.trim(),
        description: description.trim() || undefined,
        joinMode,
        addCreatorAsMember: true,
      });
      router.replace(`/inbox/${groupId}/${result.slug}`);
    } catch (error: any) {
      console.error("Failed to create channel:", error);

      // ConvexError delivers its thrown payload on `error.data`. In production
      // `error.message` is only a generic "[Request ID: …] Server Error"
      // string, so prefer `error.data` — otherwise the friendly server
      // messages below never match and the raw "Server Error" leaks into the
      // toast (which is exactly what users saw on the 20-channel limit).
      // The payload is a bare string for createCustomChannel's errors but a
      // `{ code, message }` object for createAutoChannel's (Planning Center),
      // so handle both shapes before falling back to `error.message`.
      const convexData = error?.data;
      const convexMessage: string =
        typeof convexData === "string"
          ? convexData
          : typeof convexData?.message === "string"
            ? convexData.message
            : error?.message ?? "";

      // Extract user-friendly error message
      let errorMessage = "Failed to create channel. Please try again.";
      if (convexMessage) {
        if (convexMessage.includes("Only group leaders")) {
          errorMessage = "Only group leaders can create channels.";
        } else if (convexMessage.includes("maximum of 20 channels")) {
          errorMessage =
            "This group has reached the maximum of 20 channels. Archive some channels to create new ones.";
        } else if (convexMessage.includes("1-50 characters")) {
          errorMessage = "Channel name must be between 1 and 50 characters.";
        } else if (
          convexMessage.includes("Not authenticated") ||
          convexMessage.includes("no auth token")
        ) {
          errorMessage = "Please log in again to create a channel.";
        } else if (!convexMessage.includes("Server Error")) {
          // Use the server's message only when it's a real ConvexError
          // payload, never the opaque production "Server Error" fallback.
          errorMessage = convexMessage;
        }
      }

      setToast({
        visible: true,
        message: errorMessage,
        type: "error",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.surfaceSecondary }]}>
        {/* Header */}
        <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={handleBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Create Channel</Text>
          <View style={styles.headerRight} />
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Channel Type Selector */}
          <View style={[styles.section, { backgroundColor: colors.surface }]}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Channel Type</Text>
            <View style={styles.segmentedControl}>
              <TouchableOpacity
                style={[
                  styles.segmentButton,
                  { borderColor: colors.inputBorder, backgroundColor: colors.surface },
                  channelType === "custom" && [
                    { backgroundColor: colors.selectedBackground },
                    { borderColor: primaryColor },
                  ],
                ]}
                onPress={() => setChannelType("custom")}
                disabled={isLoading}
              >
                <Ionicons
                  name="people-outline"
                  size={18}
                  color={channelType === "custom" ? primaryColor : colors.textSecondary}
                  style={styles.segmentIcon}
                />
                <Text
                  numberOfLines={2}
                  style={[
                    styles.segmentText,
                    { color: colors.textSecondary },
                    channelType === "custom" && [
                      styles.segmentTextSelected,
                      { color: primaryColor },
                    ],
                  ]}
                >
                  Custom
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.segmentButton,
                  { borderColor: colors.inputBorder, backgroundColor: colors.surface },
                  channelType === "pco_services" && [
                    { backgroundColor: colors.selectedBackground },
                    { borderColor: primaryColor },
                  ],
                  !isCommunityAdmin && { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
                ]}
                onPress={() => isCommunityAdmin && setChannelType("pco_services")}
                disabled={isLoading || !isCommunityAdmin}
              >
                <Ionicons
                  name={isCommunityAdmin ? "sync-outline" : "lock-closed"}
                  size={18}
                  color={
                    !isCommunityAdmin
                      ? colors.textTertiary
                      : channelType === "pco_services"
                        ? primaryColor
                        : colors.textSecondary
                  }
                  style={styles.segmentIcon}
                />
                <Text
                  numberOfLines={2}
                  style={[
                    styles.segmentText,
                    { color: colors.textSecondary },
                    channelType === "pco_services" && [
                      styles.segmentTextSelected,
                      { color: primaryColor },
                    ],
                    !isCommunityAdmin && { color: colors.textTertiary },
                  ]}
                >
                  Planning Center
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.segmentButton,
                  { borderColor: colors.inputBorder, backgroundColor: colors.surface },
                  channelType === "cross_team" && [
                    { backgroundColor: colors.selectedBackground },
                    { borderColor: primaryColor },
                  ],
                ]}
                onPress={() => setChannelType("cross_team")}
                disabled={isLoading}
              >
                <Ionicons
                  name="git-merge-outline"
                  size={18}
                  color={channelType === "cross_team" ? primaryColor : colors.textSecondary}
                  style={styles.segmentIcon}
                />
                <Text
                  numberOfLines={2}
                  style={[
                    styles.segmentText,
                    { color: colors.textSecondary },
                    channelType === "cross_team" && [
                      styles.segmentTextSelected,
                      { color: primaryColor },
                    ],
                  ]}
                >
                  Cross-team channel
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={[styles.channelTypeHint, { color: colors.textTertiary }]}>
              {channelType === "custom"
                ? "A permanent channel — you choose who is in it. Best for ongoing, not time-bound groups."
                : channelType === "cross_team"
                  ? "Auto-syncs members rostered for chosen roles across multiple teams."
                  : "Automatically sync members from Planning Center Services"}
            </Text>
            {!isCommunityAdmin && (
              <Text style={[styles.adminOnlyHint, { color: colors.textTertiary }]}>
                Only community admins can create Planning Center synced channels
              </Text>
            )}
          </View>

          {/* PCO Auto Channel Config */}
          {channelType === "pco_services" && communityId && (
            <View style={[styles.section, { backgroundColor: colors.surface }]}>
              <PcoAutoChannelConfig
                communityId={communityId}
                onChange={setAutoConfig}
              />
            </View>
          )}

          {/* Cross-team Selector Picker — choose which teams + roles feed the
              channel's auto-synced membership. */}
          {channelType === "cross_team" && groupId && (
            <View style={[styles.section, { backgroundColor: colors.surface }]}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                Synced roles <Text style={{ color: colors.error }}>*</Text>
              </Text>
              <Text style={[styles.channelTypeHint, { color: colors.textTertiary, marginBottom: 12 }]}>
                Pick a team, then choose specific roles or any role on it.
                Anyone rostered for those roles is auto-added.
              </Text>
              <CrossTeamSelectorPicker
                groupId={groupId as Id<"groups">}
                selectors={crossTeamSelectors}
                onChange={setCrossTeamSelectors}
                disabled={isLoading}
              />
            </View>
          )}

          {/* Form Section */}
          <View style={[styles.section, { backgroundColor: colors.surface }]}>
            {/* Channel Name */}
            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                Channel Name <Text style={{ color: colors.error }}>*</Text>
              </Text>
              <View style={[styles.inputContainer, { borderColor: colors.inputBorder, backgroundColor: colors.inputBackground }]}>
                <TextInput
                  style={[styles.input, { color: colors.text }]}
                  value={name}
                  onChangeText={handleNameChange}
                  placeholder="Enter channel name"
                  placeholderTextColor={colors.inputPlaceholder}
                  maxLength={MAX_NAME_LENGTH}
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType="next"
                  editable={!isLoading}
                />
              </View>
              <View style={styles.helperRow}>
                <Text style={[styles.helperText, { color: colors.textTertiary }]}>
                  Channel names cannot be changed after creation
                </Text>
                <Text style={[styles.charCount, { color: colors.textTertiary }]}>
                  {name.length}/{MAX_NAME_LENGTH}
                </Text>
              </View>
            </View>

            {/* Description */}
            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Description</Text>
              <View style={[styles.inputContainer, { borderColor: colors.inputBorder, backgroundColor: colors.inputBackground }]}>
                <TextInput
                  style={[styles.input, styles.textArea, { color: colors.text }]}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Add a description (optional)"
                  placeholderTextColor={colors.inputPlaceholder}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                  editable={!isLoading}
                />
              </View>
            </View>

            {/* Join Mode (Custom channels only) */}
            {channelType === "custom" && (
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>Join Mode</Text>
                <View style={styles.segmentedControl}>
                  <TouchableOpacity
                    style={[
                      styles.segmentButton,
                      { borderColor: colors.inputBorder, backgroundColor: colors.surface },
                      joinMode === "open" && [
                        { backgroundColor: colors.selectedBackground },
                        { borderColor: primaryColor },
                      ],
                    ]}
                    onPress={() => setJoinMode("open")}
                    disabled={isLoading}
                  >
                    <Ionicons
                      name="enter-outline"
                      size={18}
                      color={joinMode === "open" ? primaryColor : colors.textSecondary}
                      style={styles.segmentIcon}
                    />
                    <Text
                      style={[
                        styles.segmentText,
                        { color: colors.textSecondary },
                        joinMode === "open" && [
                          styles.segmentTextSelected,
                          { color: primaryColor },
                        ],
                      ]}
                    >
                      Open
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.segmentButton,
                      { borderColor: colors.inputBorder, backgroundColor: colors.surface },
                      joinMode === "approval_required" && [
                        { backgroundColor: colors.selectedBackground },
                        { borderColor: primaryColor },
                      ],
                    ]}
                    onPress={() => setJoinMode("approval_required")}
                    disabled={isLoading}
                  >
                    <Ionicons
                      name="shield-checkmark-outline"
                      size={18}
                      color={joinMode === "approval_required" ? primaryColor : colors.textSecondary}
                      style={styles.segmentIcon}
                    />
                    <Text
                      style={[
                        styles.segmentText,
                        { color: colors.textSecondary },
                        joinMode === "approval_required" && [
                          styles.segmentTextSelected,
                          { color: primaryColor },
                        ],
                      ]}
                    >
                      Approval
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text style={[styles.channelTypeHint, { color: colors.textTertiary }]}>
                  {joinMode === "open"
                    ? "Anyone in the group can join via invite link"
                    : "Members must request and be approved by a leader"}
                </Text>
              </View>
            )}
          </View>

          {/* Create Button */}
          <View style={styles.buttonContainer}>
            <Button
              onPress={handleCreate}
              disabled={!canCreate}
              loading={isLoading}
              style={styles.createButton}
            >
              Create Channel
            </Button>
          </View>
        </ScrollView>

        {/* Toast */}
        <Toast
          visible={toast.visible}
          message={toast.message}
          type={toast.type}
          onClose={() => setToast((prev) => ({ ...prev, visible: false }))}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
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
    width: 40,
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
    padding: 20,
    marginBottom: 16,
    ...Platform.select({
      web: {
        boxShadow: "0px 2px 8px rgba(0, 0, 0, 0.05)",
      },
      default: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
      },
    }),
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
  },
  inputContainer: {
    borderWidth: 2,
    borderRadius: 14,
  },
  input: {
    padding: 14,
    fontSize: 16,
    minHeight: 48,
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: "top",
    paddingTop: 14,
  },
  helperRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 6,
  },
  helperText: {
    fontSize: 12,
    flex: 1,
  },
  charCount: {
    fontSize: 12,
    marginLeft: 8,
  },
  buttonContainer: {
    marginTop: 8,
  },
  createButton: {
    width: "100%",
  },
  segmentedControl: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 8,
  },
  segmentButton: {
    flexGrow: 1,
    flexBasis: "40%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 2,
    minHeight: 60,
  },
  segmentIcon: {
    marginRight: 6,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: "500",
    textAlign: "center",
    flexShrink: 1,
  },
  segmentTextSelected: {
    fontWeight: "600",
  },
  channelTypeHint: {
    fontSize: 12,
    marginTop: 4,
  },
  adminOnlyHint: {
    fontSize: 12,
    fontStyle: "italic",
    marginTop: 8,
  },
});
