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
import { PcoAutoChannelConfig, type AutoChannelConfig } from "@features/channels";
import type { Id } from "@services/api/convex";

type ChannelType = "custom" | "pco_services";

const MAX_NAME_LENGTH = 50;

export default function CreateChannelScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { token, community, user } = useAuth();
  const { primaryColor } = useCommunityTheme();

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

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
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
  // For PCO channels, also require autoConfig to be set
  const canCreate =
    isNameValid &&
    !isLoading &&
    (channelType === "custom" || autoConfig !== null);

  const handleCreate = async () => {
    if (!canCreate) return;

    setIsLoading(true);

    try {
      let slug: string;

      if (channelType === "custom") {
        const result = await createCustomChannel({
          groupId: groupId as Id<"groups">,
          name: name.trim(),
          description: description.trim() || undefined,
        });
        slug = result.slug;
      } else {
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
        slug = result.slug;
      }

      // Navigate to the new channel
      router.replace(`/inbox/${groupId}/${slug}`);
    } catch (error: any) {
      console.error("Failed to create channel:", error);

      // Extract user-friendly error message
      let errorMessage = "Failed to create channel. Please try again.";
      if (error?.message) {
        // Handle Convex errors which often have the message in error.message
        if (error.message.includes("Only group leaders")) {
          errorMessage = "Only group leaders can create channels.";
        } else if (error.message.includes("maximum of 20 channels")) {
          errorMessage =
            "This group has reached the maximum of 20 channels. Archive some channels to create new ones.";
        } else if (error.message.includes("1-50 characters")) {
          errorMessage = "Channel name must be between 1 and 50 characters.";
        } else if (
          error.message.includes("Not authenticated") ||
          error.message.includes("no auth token")
        ) {
          errorMessage = "Please log in again to create a channel.";
        } else {
          // Use the error message if it seems user-friendly
          errorMessage = error.message;
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
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#000" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Create Channel</Text>
          <View style={styles.headerRight} />
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Channel Type Selector */}
          <View style={styles.section}>
            <Text style={styles.label}>Channel Type</Text>
            <View style={styles.segmentedControl}>
              <TouchableOpacity
                style={[
                  styles.segmentButton,
                  channelType === "custom" && [
                    styles.segmentButtonSelected,
                    { borderColor: primaryColor },
                  ],
                ]}
                onPress={() => setChannelType("custom")}
                disabled={isLoading}
              >
                <Ionicons
                  name="people-outline"
                  size={18}
                  color={channelType === "custom" ? primaryColor : "#666"}
                  style={styles.segmentIcon}
                />
                <Text
                  style={[
                    styles.segmentText,
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
                  channelType === "pco_services" && [
                    styles.segmentButtonSelected,
                    { borderColor: primaryColor },
                  ],
                  !isCommunityAdmin && styles.segmentButtonDisabled,
                ]}
                onPress={() => isCommunityAdmin && setChannelType("pco_services")}
                disabled={isLoading || !isCommunityAdmin}
              >
                <Ionicons
                  name={isCommunityAdmin ? "sync-outline" : "lock-closed"}
                  size={18}
                  color={
                    !isCommunityAdmin
                      ? "#999"
                      : channelType === "pco_services"
                        ? primaryColor
                        : "#666"
                  }
                  style={styles.segmentIcon}
                />
                <Text
                  style={[
                    styles.segmentText,
                    channelType === "pco_services" && [
                      styles.segmentTextSelected,
                      { color: primaryColor },
                    ],
                    !isCommunityAdmin && styles.segmentTextDisabled,
                  ]}
                >
                  Planning Center
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.channelTypeHint}>
              {channelType === "custom"
                ? "Manually manage who is in this channel"
                : "Automatically sync members from Planning Center Services"}
            </Text>
            {!isCommunityAdmin && (
              <Text style={styles.adminOnlyHint}>
                Only community admins can create Planning Center synced channels
              </Text>
            )}
          </View>

          {/* PCO Auto Channel Config */}
          {channelType === "pco_services" && communityId && (
            <View style={styles.section}>
              <PcoAutoChannelConfig
                communityId={communityId}
                onChange={setAutoConfig}
              />
            </View>
          )}

          {/* Form Section */}
          <View style={styles.section}>
            {/* Channel Name */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>
                Channel Name <Text style={styles.required}>*</Text>
              </Text>
              <View style={styles.inputContainer}>
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={handleNameChange}
                  placeholder="Enter channel name"
                  placeholderTextColor="#bdbdc1"
                  maxLength={MAX_NAME_LENGTH}
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType="next"
                  editable={!isLoading}
                />
              </View>
              <View style={styles.helperRow}>
                <Text style={styles.helperText}>
                  Channel names cannot be changed after creation
                </Text>
                <Text style={styles.charCount}>
                  {name.length}/{MAX_NAME_LENGTH}
                </Text>
              </View>
            </View>

            {/* Description */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Description</Text>
              <View style={styles.inputContainer}>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Add a description (optional)"
                  placeholderTextColor="#bdbdc1"
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                  editable={!isLoading}
                />
              </View>
            </View>
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
    backgroundColor: "#F5F5F5",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E5E5",
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
    color: "#000",
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
    backgroundColor: "#fff",
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
    color: "#333",
    marginBottom: 8,
  },
  required: {
    color: "#FF3B30",
  },
  inputContainer: {
    borderWidth: 2,
    borderColor: "#ecedf0",
    borderRadius: 14,
    backgroundColor: "#ffffff",
  },
  input: {
    padding: 14,
    fontSize: 16,
    color: "#000000",
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
    color: "#888",
    flex: 1,
  },
  charCount: {
    fontSize: 12,
    color: "#888",
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
    gap: 12,
    marginBottom: 8,
  },
  segmentButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#ecedf0",
    backgroundColor: "#fff",
  },
  segmentButtonSelected: {
    backgroundColor: "#f9f5ff",
  },
  segmentIcon: {
    marginRight: 6,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#666",
  },
  segmentTextSelected: {
    fontWeight: "600",
  },
  segmentButtonDisabled: {
    backgroundColor: "#f5f5f5",
    borderColor: "#e0e0e0",
  },
  segmentTextDisabled: {
    color: "#999",
  },
  channelTypeHint: {
    fontSize: 12,
    color: "#888",
    marginTop: 4,
  },
  adminOnlyHint: {
    fontSize: 12,
    color: "#999",
    fontStyle: "italic",
    marginTop: 8,
  },
});
