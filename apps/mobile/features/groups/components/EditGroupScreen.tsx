/**
 * EditGroupScreen - Form for editing group details
 *
 * Current capabilities:
 * - Basic information (name, description, max capacity)
 * - Group preview/cover image upload
 * - Location (address fields)
 * - Meeting schedule (day, start/end times, meeting type, online link)
 */
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Platform,
  Switch,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
} from "react-native";
import { useForm, Controller, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@providers/AuthProvider";
import { uploadAsync, FileSystemUploadType } from "expo-file-system/legacy";
import {
  FormInput,
  Button,
  SkeletonCard,
  Select,
  DatePicker,
  ImagePicker,
} from "@components/ui";
import { useGroupDetails, useUpdateGroup } from "../hooks";
import { GroupUpdateData } from "../types";
import type { components } from "@/types/api";
import { validateZipCode, normalizeZipCode } from "../utils/geocodeLocation";
import {
  useAuthenticatedAction,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import { formatError } from "@/utils/error-handling";

// Validation schema for group edit form
const groupEditSchema = z.object({
  name: z
    .string()
    .min(1, "Group name is required")
    .max(100, "Name is too long"),
  description: z.string().optional(),
  address_line1: z.string().optional(),
  address_line2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip_code: z.string().optional().refine(
    (val) => {
      if (!val || val.trim() === '') return true;
      return validateZipCode(val).isValid;
    },
    (val) => ({ message: validateZipCode(val).error || 'Invalid ZIP code' })
  ),
  default_meeting_link: z
    .union([z.string().url("Invalid URL"), z.literal("")])
    .optional(),
  external_chat_link: z
    .union([z.string().url("Invalid URL"), z.literal("")])
    .optional(),
  max_capacity: z.string().optional(),
  default_day: z.number().min(0).max(6).optional(),
  default_start_time: z.string().optional(),
  default_end_time: z.string().optional(),
  default_meeting_type: z.number().min(1).max(2).optional(),
});

type GroupEditFormData = z.infer<typeof groupEditSchema>;
// Custom GroupDetail type that matches the transformed data from useGroupDetails hook
// The hook transforms tRPC response to snake_case with group_type as number
type GroupDetail = {
  id: string;
  uuid: string;
  name: string;
  title: string;
  description: string | null;
  group_type: number; // Transformed to number by useGroupDetails
  group_type_name: string;
  group_type_slug: string;
  user_role: string | null;
  user_request_status: string | null;
  is_archived: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  main_channel_id: string | null;
  leaders_channel_id: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  default_day: number | null;
  default_start_time: string | null;
  default_end_time: string | null;
  default_meeting_type: number | null;
  default_meeting_link: string | null;
  is_on_break: boolean | null;
  break_until: string | null;
  preview: string | null;
  externalChatLink: string | null;
  members_count: number;
  members: any[];
  leaders: any[];
  highlights: any[];
};

export function EditGroupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { group_id } = useLocalSearchParams<{ group_id: string }>();

  const { data: group, isLoading } = useGroupDetails(group_id);
  const updateGroupMutation = useUpdateGroup();
  const setHiddenFromDiscovery = useAuthenticatedMutation(
    api.functions.groups.index.setHiddenFromDiscovery,
  );
  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  // Local optimistic state for the admin-only "hide from discovery" toggle.
  // Synced from the fetched group whenever it changes.
  const [hiddenFromDiscovery, setHiddenFromDiscoveryState] = useState(false);
  const [isSavingHidden, setIsSavingHidden] = useState(false);

  useEffect(() => {
    if (group) {
      setHiddenFromDiscoveryState(
        Boolean((group as any).hidden_from_discovery),
      );
    }
  }, [group]);

  // Convex action for R2 upload
  const getR2UploadUrl = useAuthenticatedAction(api.functions.uploads.getR2UploadUrl);

  // Image upload function using R2
  const uploadImage = async (imageUri: string) => {
    setIsUploadingImage(true);
    console.log("Uploading image via R2 presigned URL, URI:", imageUri.substring(0, 50) + "...");

    try {
      // Get file info from URI
      const fileName = imageUri.split('/').pop() || 'group-image.jpg';
      // Clean filename (remove query params if present)
      const cleanFileName = fileName.split('?')[0];
      const fileExtension = cleanFileName.split('.').pop()?.toLowerCase() || 'jpg';
      const contentType = `image/${fileExtension === 'jpg' ? 'jpeg' : fileExtension}`;

      // 1. Get R2 presigned URL from Convex action
      const { uploadUrl, storagePath } = await getR2UploadUrl({
        fileName: cleanFileName,
        contentType,
        folder: "groups",
      });

      console.log("Got R2 presigned URL, uploading...");

      // 2. Upload directly to R2
      if (Platform.OS === 'web') {
        // Web: Use fetch/blob
        const response = await fetch(imageUri);
        const blob = await response.blob();

        const uploadResponse = await fetch(uploadUrl, {
          method: 'PUT',
          body: blob,
          headers: {
            'Content-Type': contentType,
          },
        });

        if (!uploadResponse.ok) {
          throw new Error(`R2 upload failed: ${uploadResponse.status}`);
        }
      } else {
        // Native (iOS/Android): Use expo-file-system for proper file handling
        const uploadResult = await uploadAsync(uploadUrl, imageUri, {
          httpMethod: 'PUT',
          uploadType: FileSystemUploadType.BINARY_CONTENT,
          headers: {
            'Content-Type': contentType,
          },
        });

        console.log("Upload result:", uploadResult.status, uploadResult.body?.substring(0, 200));

        if (uploadResult.status < 200 || uploadResult.status >= 300) {
          throw new Error(`R2 upload failed: ${uploadResult.status} - ${uploadResult.body?.substring(0, 100)}`);
        }
      }

      console.log("R2 upload complete, saving preview path to group...");

      // 3. Save the R2 storage path to the group's preview field
      await updateGroupMutation.mutateAsync({
        groupId: group_id,
        preview: storagePath, // e.g., "r2:groups/uuid-filename.jpg"
      });

      console.log("Group preview updated successfully");
      setIsUploadingImage(false);
    } catch (error: any) {
      console.error("Upload error:", error);
      setIsUploadingImage(false);

      const errorMessage = formatError(error, "Failed to upload group picture");

      Alert.alert(
        "Upload Failed",
        `${errorMessage}\n\nThe image was not uploaded. Please try again.`
      );
      throw error;
    }
  };

  const handleImageSelected = async (imageUri: string) => {
    console.log("Image selected, URI:", imageUri);

    // Validate URI before proceeding
    if (!imageUri || typeof imageUri !== "string") {
      Alert.alert("Error", "Invalid image selected");
      return;
    }

    setSelectedImageUri(imageUri);

    // Automatically upload when image is selected
    try {
      // Small delay to ensure image URI is fully ready and image picker has finished
      await new Promise((resolve) => setTimeout(resolve, 200));

      console.log("Starting upload for URI:", imageUri);
      await uploadImage(imageUri);
    } catch (error) {
      // Error already handled in uploadImage
      console.error("Failed to upload image:", error);
      // Don't clear selectedImageUri on error - let user see what they selected
    }
  };

  const handleImageRemoved = async () => {
    // Clear local state immediately for responsive UI
    setSelectedImageUri(null);

    // Call backend to remove the preview image
    try {
      console.log("Removing preview image...");
      // Update group to remove preview
      await updateGroupMutation.mutateAsync({
        groupId: group_id,
        preview: "",
      });

      console.log("Preview removed - Convex queries auto-refresh");
      Alert.alert("Success", "Group picture removed successfully");
    } catch (error: any) {
      const errorMessage = formatError(error, "Failed to remove group picture");

      Alert.alert("Error", errorMessage);
      console.error("Failed to remove preview image:", error);
    }
  };

  const {
    control,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<GroupEditFormData>({
    resolver: zodResolver(groupEditSchema),
    defaultValues: {
      name: group?.name || "",
      description: group?.description || "",
      address_line1: (group as any)?.address_line1 || "",
      address_line2: (group as any)?.address_line2 || "",
      city: group?.city || "",
      state: group?.state || "",
      zip_code: (group as any)?.zip_code || "",
      default_meeting_link: group?.default_meeting_link || "",
      external_chat_link: (group as any)?.externalChatLink || "",
      max_capacity: (group as any)?.max_capacity?.toString() || "",
      default_day: group?.default_day ?? undefined,
      default_start_time: group?.default_start_time || "",
      default_end_time: group?.default_end_time || "",
      default_meeting_type: group?.default_meeting_type ?? undefined,
    },
    values: group
      ? {
          name: group.name || "",
          description: group.description || "",
          address_line1: (group as any).address_line1 || "",
          address_line2: (group as any).address_line2 || "",
          city: group.city || "",
          state: group.state || "",
          zip_code: (group as any).zip_code || "",
          default_meeting_link: group.default_meeting_link || "",
          external_chat_link: (group as any).externalChatLink || "",
          max_capacity: (group as any).max_capacity?.toString() || "",
          default_day: group.default_day ?? undefined,
          default_start_time: group.default_start_time || "",
          default_end_time: group.default_end_time || "",
          default_meeting_type: group.default_meeting_type ?? undefined,
        }
      : undefined,
  });

  // Watch location fields to show geocoding warning
  const addressLine1 = watch("address_line1");
  const city = watch("city");
  const state = watch("state");
  const zipCode = watch("zip_code");

  // Show warning if address fields are filled but no valid ZIP code
  const hasAddressWithoutZip =
    (addressLine1?.trim() || city?.trim() || state?.trim()) &&
    (!zipCode?.trim() || !validateZipCode(zipCode).isValid);

  // Check if current user is a leader or community admin
  // Community admins (user.is_admin === true) can edit any group in their community
  const isCommunityAdmin = user?.is_admin === true;
  const canEditGroup = React.useMemo(() => {
    if (!group || !user?.id) return false;

    // Check if user is a group leader
    // Compare as strings since user.id is now a Convex ID string
    const isGroupLeader =
      group.leaders?.some((leader) => String(leader.id) === String(user.id)) || false;

    return isCommunityAdmin || isGroupLeader;
  }, [group, user?.id, isCommunityAdmin]);

  const handleToggleHiddenFromDiscovery = async (next: boolean) => {
    const previous = hiddenFromDiscovery;
    setHiddenFromDiscoveryState(next); // optimistic
    setIsSavingHidden(true);
    try {
      await setHiddenFromDiscovery({
        groupId: group_id as any,
        hidden: next,
      });
    } catch (error) {
      setHiddenFromDiscoveryState(previous); // revert
      Alert.alert(
        "Couldn't update visibility",
        formatError(error, "Failed to update discovery visibility"),
      );
    } finally {
      setIsSavingHidden(false);
    }
  };

  const onSubmit: SubmitHandler<GroupEditFormData> = async (data) => {
    // Clear selectedImageUri so ImagePicker uses group.preview from refetched data
    setSelectedImageUri(null);

    // Convert form data to API format
    // Send empty strings for cleared fields (backend converts them to None to clear the field)
    const updateData: GroupUpdateData = {
      name: data.name,
      // For string fields: send trimmed value, or empty string if empty (to clear field)
      description: data.description?.trim() ?? "",
      address_line1: data.address_line1?.trim() ?? "",
      address_line2: data.address_line2?.trim() ?? "",
      city: data.city?.trim() ?? "",
      state: data.state?.trim() ?? "",
      zip_code: normalizeZipCode(data.zip_code) ?? "",
      default_meeting_link: data.default_meeting_link?.trim() ?? "",
      external_chat_link: data.external_chat_link?.trim() ?? "",
      max_capacity: data.max_capacity
        ? parseInt(data.max_capacity, 10)
        : undefined,
      default_day: data.default_day,
      default_start_time: data.default_start_time?.trim() || undefined,
      default_end_time: data.default_end_time?.trim() || undefined,
      default_meeting_type: data.default_meeting_type,
    };

    try {
      await updateGroupMutation.mutateAsync({
        groupId: group_id,
        ...updateData,
      });
    } catch (error) {
      // Error handled in mutation
    }
  };

  if (isLoading) {
    return (
      <>
        <View style={[styles.container, { paddingTop: insets.top }]}>
          <View style={styles.header}>
            <SkeletonCard style={{ height: 44 }} />
          </View>
          <ScrollView style={styles.scrollView}>
            <View style={styles.content}>
              <SkeletonCard style={{ marginBottom: 12 }} />
              <SkeletonCard style={{ marginBottom: 12 }} />
              <SkeletonCard style={{ marginBottom: 12 }} />
            </View>
          </ScrollView>
        </View>
      </>
    );
  }

  // If user is not a leader or community admin, show access denied
  if (!canEditGroup) {
    return (
      <>
        <View style={[styles.container, { paddingTop: insets.top }]}>
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={styles.backButton}
            >
              <Ionicons name="arrow-back" size={24} color="#000" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Edit Group</Text>
            <View style={styles.headerRight} />
          </View>
          <View style={styles.centerContainer}>
            <Text style={styles.errorText}>
              You must be a group leader or community admin to edit this group.
            </Text>
          </View>
        </View>
      </>
    );
  }

  return (
    <>
      <KeyboardAvoidingView
        style={[styles.container, { paddingTop: insets.top }]}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={24} color="#000" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit Group</Text>
          <View style={styles.headerRight} />
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Basic Information Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Basic Information</Text>

            {/* Group Picture Upload */}
            <View style={styles.imagePickerContainer}>
              <Text style={styles.imagePickerLabel}>Group Picture</Text>
              <ImagePicker
                onImageSelected={handleImageSelected}
                onImageRemoved={handleImageRemoved}
                currentImage={
                  selectedImageUri ||
                  (group as GroupDetail | undefined)?.preview ||
                  undefined
                }
                isUploading={isUploadingImage}
                buttonText="Select Group Picture"
                maxWidth={1200}
                maxHeight={800}
                quality={0.8}
                allowsEditing={true}
              />
            </View>

            <FormInput
              name="name"
              control={control}
              label="Group Name"
              required
              error={errors.name}
              placeholder="Enter group name"
              autoCapitalize="words"
            />

            <FormInput
              name="description"
              control={control}
              label="Description"
              error={errors.description}
              placeholder="Enter group description"
              multiline
              numberOfLines={4}
              inputStyle={styles.textArea}
            />

            <FormInput
              name="max_capacity"
              control={control}
              label="Max Capacity"
              error={errors.max_capacity}
              placeholder="Enter maximum number of members"
              keyboardType="number-pad"
            />
          </View>

          {/* Location Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Location</Text>

            <FormInput
              name="address_line1"
              control={control}
              label="Address Line 1"
              error={errors.address_line1}
              placeholder="Street address"
              autoCapitalize="words"
            />

            <FormInput
              name="address_line2"
              control={control}
              label="Address Line 2"
              error={errors.address_line2}
              placeholder="Apt, suite, etc. (optional)"
              autoCapitalize="words"
            />

            <FormInput
              name="city"
              control={control}
              label="City"
              error={errors.city}
              placeholder="City"
              autoCapitalize="words"
            />

            <FormInput
              name="state"
              control={control}
              label="State"
              error={errors.state}
              placeholder="State"
              autoCapitalize="characters"
            />

            <FormInput
              name="zip_code"
              control={control}
              label="ZIP Code"
              error={errors.zip_code}
              placeholder="ZIP code"
              keyboardType="number-pad"
            />

            {/* Geocoding warning */}
            {hasAddressWithoutZip && (
              <View style={styles.locationWarning}>
                <Ionicons name="warning" size={20} color="#F59E0B" />
                <Text style={styles.locationWarningText}>
                  Add a valid ZIP code so this group appears on the map
                </Text>
              </View>
            )}
          </View>

          {/* Meeting Schedule Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Meeting Schedule</Text>

            <Controller
              name="default_day"
              control={control}
              render={({ field: { onChange, value } }) => (
                <Select
                  label="Day of Week"
                  placeholder="Select a day"
                  value={value}
                  options={[
                    { label: "Sunday", value: 0 },
                    { label: "Monday", value: 1 },
                    { label: "Tuesday", value: 2 },
                    { label: "Wednesday", value: 3 },
                    { label: "Thursday", value: 4 },
                    { label: "Friday", value: 5 },
                    { label: "Saturday", value: 6 },
                  ]}
                  onSelect={onChange}
                  error={errors.default_day?.message}
                />
              )}
            />

            <Controller
              name="default_start_time"
              control={control}
              render={({ field: { onChange, value } }) => (
                <DatePicker
                  label="Start Time"
                  mode="time"
                  value={
                    value
                      ? (() => {
                          const [hours, minutes] = value.split(":");
                          const date = new Date();
                          date.setHours(
                            parseInt(hours, 10),
                            parseInt(minutes, 10),
                            0,
                            0
                          );
                          return date;
                        })()
                      : null
                  }
                  onChange={(date) => {
                    if (date) {
                      const hours = date.getHours().toString().padStart(2, "0");
                      const minutes = date
                        .getMinutes()
                        .toString()
                        .padStart(2, "0");
                      onChange(`${hours}:${minutes}`);
                    } else {
                      onChange("");
                    }
                  }}
                  placeholder="Select start time"
                  error={errors.default_start_time?.message}
                />
              )}
            />

            <Controller
              name="default_end_time"
              control={control}
              render={({ field: { onChange, value } }) => (
                <DatePicker
                  label="End Time"
                  mode="time"
                  value={
                    value
                      ? (() => {
                          const [hours, minutes] = value.split(":");
                          const date = new Date();
                          date.setHours(
                            parseInt(hours, 10),
                            parseInt(minutes, 10),
                            0,
                            0
                          );
                          return date;
                        })()
                      : null
                  }
                  onChange={(date) => {
                    if (date) {
                      const hours = date.getHours().toString().padStart(2, "0");
                      const minutes = date
                        .getMinutes()
                        .toString()
                        .padStart(2, "0");
                      onChange(`${hours}:${minutes}`);
                    } else {
                      onChange("");
                    }
                  }}
                  placeholder="Select end time"
                  error={errors.default_end_time?.message}
                />
              )}
            />

            <Controller
              name="default_meeting_type"
              control={control}
              render={({ field: { onChange, value } }) => (
                <Select
                  label="Meeting Type"
                  placeholder="Select meeting type"
                  value={value}
                  options={[
                    { label: "In-Person", value: 1 },
                    { label: "Online", value: 2 },
                  ]}
                  onSelect={onChange}
                  error={errors.default_meeting_type?.message}
                />
              )}
            />

            <FormInput
              name="default_meeting_link"
              control={control}
              label="Online Meeting Link"
              error={errors.default_meeting_link}
              placeholder="https://zoom.us/j/..."
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {/* External Chat Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>External Chat</Text>
            <Text style={styles.sectionDescription}>
              If your group also communicates on another platform like WhatsApp, Slack, Telegram, or Discord, add the invite link here. Members will see a "Join" button in the chat to join your external group.
            </Text>

            <FormInput
              name="external_chat_link"
              control={control}
              label="External Chat Link"
              error={errors.external_chat_link}
              placeholder="https://chat.whatsapp.com/... or https://discord.gg/..."
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {/* Visibility Section — community admins only */}
          {isCommunityAdmin && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Visibility</Text>
              <View style={styles.toggleRow}>
                <View style={styles.toggleTextWrap}>
                  <Text style={styles.toggleLabel}>Hide from discovery</Text>
                  <Text style={styles.toggleDescription}>
                    When on, this group won't appear on the map, near-me page,
                    or community group browse. People with a direct share link
                    can still view and request to join.
                  </Text>
                </View>
                <Switch
                  value={hiddenFromDiscovery}
                  onValueChange={handleToggleHiddenFromDiscovery}
                  disabled={isSavingHidden}
                />
              </View>
            </View>
          )}

          {/* Action Buttons */}
          <View style={styles.buttonContainer}>
            <Button
              onPress={handleSubmit(onSubmit)}
              disabled={isSubmitting || updateGroupMutation.isPending}
              loading={isSubmitting || updateGroupMutation.isPending}
              style={styles.saveButton}
            >
              Save Changes
            </Button>

            <Button
              onPress={() => router.back()}
              variant="secondary"
              disabled={isSubmitting || updateGroupMutation.isPending}
              style={styles.cancelButton}
            >
              Cancel
            </Button>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
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
    padding: 8,
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
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 14,
    color: "#666",
    lineHeight: 20,
    marginBottom: 16,
  },
  textArea: {
    height: 100,
    textAlignVertical: "top",
  },
  buttonContainer: {
    gap: 12,
    marginTop: 8,
  },
  saveButton: {
    width: "100%",
  },
  cancelButton: {
    width: "100%",
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  errorText: {
    fontSize: 16,
    color: "#FF3B30",
    textAlign: "center",
  },
  content: {
    padding: 12,
  },
  imagePickerContainer: {
    marginBottom: 20,
  },
  imagePickerLabel: {
    fontSize: 16,
    fontWeight: "500",
    color: "#333",
    marginBottom: 8,
  },
  locationWarning: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FEF3C7",
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
    gap: 8,
  },
  locationWarningText: {
    flex: 1,
    fontSize: 14,
    color: "#92400E",
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  toggleTextWrap: {
    flex: 1,
  },
  toggleLabel: {
    fontSize: 16,
    fontWeight: "500",
    color: "#333",
    marginBottom: 4,
  },
  toggleDescription: {
    fontSize: 13,
    color: "#666",
    lineHeight: 18,
  },
});
