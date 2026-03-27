/**
 * CreateGroupScreen - Form for creating a new group
 *
 * Capabilities:
 * - Group type selection
 * - Basic information (name, description, max capacity)
 * - Group preview/cover image upload
 * - Location (address fields)
 * - Meeting schedule (day, start/end times, meeting type, online link)
 * - Member search and selection
 */
import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Platform,
  TouchableOpacity,
  Image,
  Alert,
} from "react-native";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { uploadAsync, FileSystemUploadType } from "expo-file-system/legacy";
import {
  FormInput,
  Button,
  Select,
  DatePicker,
  ImagePicker,
  MemberSearch,
} from "@components/ui";
import { useCreateGroup, CreateGroupFormData } from "../hooks/useCreateGroup";
import type { CommunityMember } from "@/types/community";
import { validateZipCode, normalizeZipCode } from "../utils/geocodeLocation";
import { useQuery, useAuthenticatedMutation, useAuthenticatedAction, api } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { useTheme } from "@hooks/useTheme";
import type { Id } from "@services/api/convex";

// Validation schema for group creation form
const groupCreateSchema = z.object({
  name: z
    .string()
    .min(1, "Group name is required")
    .max(100, "Name is too long"),
  group_type_id: z.string({ required_error: "Group type is required" }),
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
  max_capacity: z.string().optional(),
  default_day: z.number().min(0).max(6).optional(),
  default_start_time: z.string().optional(),
  default_end_time: z.string().optional(),
  default_meeting_type: z.number().min(1).max(2).optional(),
});

type GroupCreateFormData = z.infer<typeof groupCreateSchema>;

export function CreateGroupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { createGroupAsync, isCreating } = useCreateGroup();
  const { user, community } = useAuth();
  const { colors, isDark } = useTheme();
  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  // Member selection state
  const [selectedMembers, setSelectedMembers] = useState<CommunityMember[]>([]);
  const [isAddingMembers, setIsAddingMembers] = useState(false);

  // Fetch group types using Convex
  const groupTypes = useQuery(
    api.functions.groupSearch.listTypes,
    community?.id
      ? { communityId: community.id as Id<"communities"> }
      : "skip"
  );
  const isLoadingGroupTypes = groupTypes === undefined;

  const {
    control,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<GroupCreateFormData>({
    resolver: zodResolver(groupCreateSchema),
    defaultValues: {
      name: "",
      description: "",
      address_line1: "",
      address_line2: "",
      city: "",
      state: "",
      zip_code: "",
      default_meeting_link: "",
      max_capacity: "",
      default_day: undefined,
      default_start_time: "",
      default_end_time: "",
      default_meeting_type: undefined,
      group_type_id: undefined,
    },
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

  // Convex mutations for adding members
  const addMemberMutation = useAuthenticatedMutation(api.functions.groupMembers.add);

  // Convex mutation for updating group (used for saving image after upload)
  const updateGroupMutation = useAuthenticatedMutation(api.functions.groups.index.update);

  // Convex action for R2 upload
  const getR2UploadUrl = useAuthenticatedAction(api.functions.uploads.getR2UploadUrl);

  // Upload image using R2 presigned URL
  const uploadGroupImage = async (groupId: string, imageUri: string) => {
    try {
      setIsUploadingImage(true);

      // Get file info from URI
      const fileName = imageUri.split('/').pop() || 'group-image.jpg';
      const fileExtension = fileName.split('.').pop()?.toLowerCase() || 'jpg';
      const contentType = `image/${fileExtension === 'jpg' ? 'jpeg' : fileExtension}`;

      // Get R2 presigned URL from Convex action
      const { uploadUrl, storagePath } = await getR2UploadUrl({
        fileName,
        contentType,
        folder: "groups",
      });

      // Upload file to R2 using expo-file-system/legacy
      const uploadResult = await uploadAsync(uploadUrl, imageUri, {
        httpMethod: 'PUT',
        uploadType: FileSystemUploadType.BINARY_CONTENT,
        headers: {
          'Content-Type': contentType,
        },
      });

      if (uploadResult.status < 200 || uploadResult.status >= 300) {
        console.error('R2 upload failed:', uploadResult.status, uploadResult.body);
        throw new Error('Failed to upload image to R2');
      }

      // Save the R2 storage path to the group's preview field
      await updateGroupMutation({
        groupId: groupId as Id<"groups">,
        preview: storagePath, // e.g., "r2:groups/uuid-filename.jpg"
      });

      setIsUploadingImage(false);
      return { success: true };
    } catch (error) {
      setIsUploadingImage(false);
      console.error("Failed to upload group image:", error);
      throw error;
    }
  };

  const handleImageSelected = (imageUri: string) => {
    setSelectedImageUri(imageUri);
  };

  const handleImageRemoved = () => {
    setSelectedImageUri(null);
  };

  // Handle member selection changes from MemberSearch
  const handleMemberSelectionChange = useCallback((members: CommunityMember[]) => {
    setSelectedMembers(members);
  }, []);

  // Remove member from selected list
  const handleRemoveMember = useCallback((userId: number | string) => {
    setSelectedMembers((prev) => prev.filter((m) => m.user_id !== userId));
  }, []);

  const onSubmit = async (data: GroupCreateFormData) => {
    // Convert form data to Convex API format (camelCase)
    const createData: CreateGroupFormData = {
      name: data.name,
      groupTypeId: data.group_type_id,
      description: data.description?.trim() || undefined,
      defaultDay: data.default_day,
      defaultStartTime: data.default_start_time?.trim() || undefined,
      defaultEndTime: data.default_end_time?.trim() || undefined,
      defaultMeetingType: data.default_meeting_type,
      defaultMeetingLink: data.default_meeting_link?.trim() || undefined,
      addressLine1: data.address_line1?.trim() || undefined,
      addressLine2: data.address_line2?.trim() || undefined,
      city: data.city?.trim() || undefined,
      state: data.state?.trim() || undefined,
      zipCode: normalizeZipCode(data.zip_code) || undefined,
    };

    try {
      const result = await createGroupAsync(createData);

      // If group was created successfully, handle post-creation tasks
      if (result?.id) {
        // Upload image if selected
        if (selectedImageUri) {
          try {
            await uploadGroupImage(result.id, selectedImageUri);
          } catch (error) {
            console.error("Image upload failed after group creation:", error);
          }
        }

        // Add selected members to the group using Convex
        if (selectedMembers.length > 0 && user?.id) {
          setIsAddingMembers(true);
          const addMemberPromises = selectedMembers.map((member) =>
            addMemberMutation({
              groupId: result.id as Id<"groups">,
              userId: String(member.user_id) as Id<"users">,
              role: "member",
            }).catch((error) => {
              console.error(
                `Failed to add member ${member.user_id}:`,
                error
              );
              return null; // Don't fail the whole operation
            })
          );

          await Promise.all(addMemberPromises);
          setIsAddingMembers(false);
        }

        // Show success message with option to view the group
        Alert.alert(
          "Group Created",
          "Your group has been created successfully!",
          [
            { text: "Done", style: "cancel", onPress: () => router.back() },
            {
              text: "View Group",
              onPress: () => router.replace(`/groups/${result.id}`),
            },
          ]
        );
      }
    } catch (error) {
      console.error("Failed to create group:", error);
      Alert.alert(
        "Error",
        "Failed to create group. Please try again."
      );
    }
  };

  // Format group types for Select component
  const groupTypeOptions = (groupTypes || []).map((type: any) => ({
    label: type.name,
    value: type.id,
  }));

  // Get initials for avatar
  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase();
  };

  return (
    <>
      <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.backgroundSecondary }]}>
        {/* Header */}
        <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Create Group</Text>
          <View style={styles.headerRight} />
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Basic Information Section */}
          <View style={[styles.section, { backgroundColor: colors.surface }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Basic Information</Text>

            {/* Group Picture Upload */}
            <View style={styles.imagePickerContainer}>
              <Text style={[styles.imagePickerLabel, { color: colors.text }]}>Group Picture</Text>
              <ImagePicker
                onImageSelected={handleImageSelected}
                onImageRemoved={handleImageRemoved}
                currentImage={selectedImageUri || undefined}
                isUploading={isUploadingImage}
                buttonText="Select Group Picture"
                maxWidth={1200}
                maxHeight={800}
                quality={0.8}
                allowsEditing={true}
              />
            </View>

            <Controller
              name="group_type_id"
              control={control}
              render={({ field: { onChange, value } }) => (
                <Select
                  label="Group Type"
                  placeholder={
                    isLoadingGroupTypes ? "Loading..." : "Select a group type"
                  }
                  value={value}
                  options={groupTypeOptions}
                  onSelect={onChange}
                  error={errors.group_type_id?.message}
                  required
                />
              )}
            />

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

          {/* Members Section */}
          <View style={[styles.section, { backgroundColor: colors.surface }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Members</Text>
            <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>
              Search and add members to this group
            </Text>

            {/* Member Search */}
            <MemberSearch
              mode="multi"
              onMultiSelect={handleMemberSelectionChange}
              selectedMembers={selectedMembers}
              excludeUserIds={selectedMembers.map((m) => m.user_id)}
              maxResults={5}
              showEmptyState={false}
              clearOnSelect={true}
              debounceMs={400}
              style={styles.memberSearch}
            />

            {/* Selected Members */}
            {selectedMembers.length > 0 && (
              <View style={styles.selectedMembersContainer}>
                <Text style={[styles.selectedMembersLabel, { color: colors.text }]}>
                  Selected Members ({selectedMembers.length})
                </Text>
                {selectedMembers.map((member) => (
                  <View key={member.user_id} style={[styles.selectedMemberCard, { backgroundColor: isDark ? '#1a2730' : '#E8F4FD' }]}>
                    <View style={[styles.memberAvatar, { backgroundColor: colors.border }]}>
                      {member.profile_photo ? (
                        <Image
                          source={{ uri: member.profile_photo }}
                          style={styles.memberAvatarImage}
                        />
                      ) : (
                        <Text style={[styles.memberAvatarText, { color: colors.textSecondary }]}>
                          {getInitials(member.first_name, member.last_name)}
                        </Text>
                      )}
                    </View>
                    <View style={styles.memberInfo}>
                      <Text style={[styles.memberName, { color: colors.text }]}>
                        {member.first_name} {member.last_name}
                      </Text>
                      <Text style={[styles.memberEmail, { color: colors.textSecondary }]}>{member.email}</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => handleRemoveMember(member.user_id)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Ionicons
                        name="close-circle"
                        size={24}
                        color={colors.destructive}
                      />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Location Section */}
          <View style={[styles.section, { backgroundColor: colors.surface }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Location</Text>

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
              <View style={[styles.locationWarning, { backgroundColor: isDark ? '#332b00' : '#FEF3C7' }]}>
                <Ionicons name="warning" size={20} color={colors.warning} />
                <Text style={[styles.locationWarningText, { color: isDark ? '#FFD60A' : '#92400E' }]}>
                  Add a valid ZIP code so this group appears on the map
                </Text>
              </View>
            )}
          </View>

          {/* Meeting Schedule Section */}
          <View style={[styles.section, { backgroundColor: colors.surface }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Meeting Schedule</Text>

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

          {/* Action Buttons */}
          <View style={styles.buttonContainer}>
            <Button
              onPress={handleSubmit(onSubmit)}
              disabled={isSubmitting || isCreating || isAddingMembers}
              loading={isSubmitting || isCreating || isAddingMembers}
              style={styles.saveButton}
            >
              {isAddingMembers ? "Adding Members..." : "Create Group"}
            </Button>

            <Button
              onPress={() => router.back()}
              variant="secondary"
              disabled={isSubmitting || isCreating || isAddingMembers}
              style={styles.cancelButton}
            >
              Cancel
            </Button>
          </View>
        </ScrollView>
      </View>
    </>
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
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 20,
  },
  sectionDescription: {
    fontSize: 14,
    marginTop: -12,
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
  imagePickerContainer: {
    marginBottom: 20,
  },
  imagePickerLabel: {
    fontSize: 16,
    fontWeight: "500",
    marginBottom: 8,
  },
  // Member search styles
  memberSearch: {
    marginHorizontal: -16,
    marginTop: -8,
  },
  memberAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  memberAvatarImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  memberAvatarText: {
    fontSize: 16,
    fontWeight: "600",
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 16,
    fontWeight: "500",
    marginBottom: 2,
  },
  memberEmail: {
    fontSize: 14,
  },
  selectedMembersContainer: {
    marginTop: 8,
  },
  selectedMembersLabel: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 12,
  },
  selectedMemberCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  locationWarning: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
    gap: 8,
  },
  locationWarningText: {
    flex: 1,
    fontSize: 14,
  },
});
