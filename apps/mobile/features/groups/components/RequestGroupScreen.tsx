/**
 * RequestGroupScreen - Form for requesting a new group creation
 *
 * Available to all community members. Submits a request that admins review.
 * The requester is automatically included as a leader.
 *
 * Capabilities:
 * - Group type selection (with descriptions)
 * - Basic information (name, description, max capacity)
 * - Location (address fields)
 * - Meeting schedule (day, start/end times, meeting type, online link)
 * - Co-leader search and selection
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Platform,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Image,
  Alert,
} from "react-native";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  FormInput,
  Button,
  Select,
} from "@components/ui";
import { UserRoute } from "@components/guards/UserRoute";
import { useRequestGroup, RequestGroupFormData } from "../hooks/useRequestGroup";
import { validateZipCode, normalizeZipCode } from "../utils/geocodeLocation";
import { useQuery, api } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import type { Id } from "@services/api/convex";
import { formatError } from "@/utils/error-handling";

// Validation schema for group request form
const groupRequestSchema = z.object({
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
  proposed_start_day: z.number().min(0).max(6).optional(),
  default_start_time: z.string().optional(),
  default_end_time: z.string().optional(),
  default_meeting_type: z.number().min(1).max(2).optional(),
});

type GroupRequestFormData = z.infer<typeof groupRequestSchema>;

interface CoLeader {
  id: string;
  firstName: string | null | undefined;
  lastName: string | null | undefined;
  profilePhoto: string | null | undefined;
}

export function RequestGroupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { community, token } = useAuth();
  const { requestGroupAsync, isRequesting } = useRequestGroup();

  // Co-leader search state
  const [leaderSearchQuery, setLeaderSearchQuery] = useState("");
  const [debouncedLeaderSearch, setDebouncedLeaderSearch] = useState("");
  const [selectedLeaders, setSelectedLeaders] = useState<CoLeader[]>([]);

  // Debounce leader search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedLeaderSearch(leaderSearchQuery);
    }, 400);
    return () => clearTimeout(timer);
  }, [leaderSearchQuery]);

  // Fetch group types using Convex
  const groupTypes = useQuery(
    api.functions.groupSearch.listTypes,
    community?.id
      ? { communityId: community.id as Id<"communities"> }
      : "skip"
  );
  const isLoadingGroupTypes = groupTypes === undefined;

  // Check if user has pending group creation requests
  const pendingRequests = useQuery(
    api.functions.groupCreationRequests.mine,
    community?.id && token
      ? {
          communityId: community.id as Id<"communities">,
          token,
          limit: 100,
        }
      : "skip"
  );
  const hasPendingRequest = pendingRequests?.some(
    (request: any) => request.status === "pending"
  );

  // Search for community members using Convex
  const leaderSearchResults = useQuery(
    api.functions.groupSearch.searchCommunityMembers,
    community?.id && debouncedLeaderSearch.length >= 2 && token
      ? {
          communityId: community.id as Id<"communities">,
          search: debouncedLeaderSearch,
          token,
          limit: 5,
          excludeUserIds: selectedLeaders.map((l) => l.id as Id<"users">),
        }
      : "skip"
  );
  const isSearchingLeaders = community?.id && debouncedLeaderSearch.length >= 2 && leaderSearchResults === undefined;

  const {
    control,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<GroupRequestFormData>({
    resolver: zodResolver(groupRequestSchema),
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
      proposed_start_day: undefined,
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

  // Add leader to selected list
  const handleAddLeader = useCallback((leader: CoLeader) => {
    setSelectedLeaders((prev) => {
      if (prev.some((l) => l.id === leader.id)) {
        return prev;
      }
      return [...prev, leader];
    });
    setLeaderSearchQuery("");
  }, []);

  // Remove leader from selected list
  const handleRemoveLeader = useCallback((leaderId: string) => {
    setSelectedLeaders((prev) => prev.filter((l) => l.id !== leaderId));
  }, []);

  const onSubmit = async (data: GroupRequestFormData) => {
    const requestData: RequestGroupFormData = {
      name: data.name,
      groupTypeId: data.group_type_id,
      description: data.description?.trim() || undefined,
      proposedStartDay: data.proposed_start_day,
      defaultStartTime: data.default_start_time?.trim() || undefined,
      defaultEndTime: data.default_end_time?.trim() || undefined,
      defaultMeetingType: data.default_meeting_type,
      defaultMeetingLink: data.default_meeting_link?.trim() || undefined,
      addressLine1: data.address_line1?.trim() || undefined,
      addressLine2: data.address_line2?.trim() || undefined,
      city: data.city?.trim() || undefined,
      state: data.state?.trim() || undefined,
      zipCode: normalizeZipCode(data.zip_code) || undefined,
      maxCapacity: data.max_capacity ? parseInt(data.max_capacity, 10) : undefined,
      proposedLeaderIds: selectedLeaders.map((l) => l.id),
    };

    try {
      await requestGroupAsync(requestData);
      // Show success alert
      Alert.alert(
        'Request Submitted',
        'Your group request has been submitted for review.',
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } catch (error: any) {
      console.error("Failed to submit group request:", error);
      const message = formatError(error, 'Failed to submit request');

      if (message.includes('already have a pending')) {
        Alert.alert(
          'Request Already Exists',
          'You already have a pending group creation request. Please wait for it to be reviewed or cancel it first.',
          [{ text: 'OK' }]
        );
      } else if (message.includes('maximum number')) {
        Alert.alert(
          'Limit Reached',
          'You have reached the maximum number of group creation requests.',
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert('Error', message, [{ text: 'OK' }]);
      }
    }
  };

  // Format group types for Select component (with descriptions)
  const groupTypeOptions = (groupTypes || []).map((type: any) => ({
    label: type.name,
    value: type.id,
    description: type.description,
  }));

  // Get initials for avatar
  const getInitials = (firstName: string | null | undefined, lastName: string | null | undefined) => {
    const first = firstName?.[0] || "";
    const last = lastName?.[0] || "";
    return `${first}${last}`.toUpperCase();
  };

  // Get selected group type description
  const selectedGroupTypeId = watch("group_type_id");
  const selectedGroupType = groupTypes?.find((t: any) => t.id === selectedGroupTypeId);

  return (
    <UserRoute>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={24} color="#000" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Request a Group</Text>
          <View style={styles.headerRight} />
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Info Banner */}
          <View style={styles.infoBanner}>
            <Ionicons name="information-circle" size={24} color="#3B82F6" />
            <Text style={styles.infoBannerText}>
              Your request will be reviewed by community admins. You'll be automatically added as a leader when approved.
            </Text>
          </View>

          {/* Pending Request Warning Banner */}
          {hasPendingRequest && (
            <View style={styles.warningBanner}>
              <Ionicons name="warning" size={24} color="#F59E0B" />
              <Text style={styles.warningBannerText}>
                You already have a pending group request. Please wait for it to be reviewed before submitting another request.
              </Text>
            </View>
          )}

          {/* Basic Information Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Basic Information</Text>

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

            {/* Show group type description if selected */}
            {selectedGroupType?.description && (
              <View style={styles.groupTypeDescription}>
                <Text style={styles.groupTypeDescriptionText}>
                  {selectedGroupType.description}
                </Text>
              </View>
            )}

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
              placeholder="Describe what your group is about"
              multiline
              numberOfLines={4}
              inputStyle={styles.textArea}
            />

            <FormInput
              name="max_capacity"
              control={control}
              label="Max Capacity (optional)"
              error={errors.max_capacity}
              placeholder="Maximum number of members"
              keyboardType="number-pad"
            />
          </View>

          {/* Co-Leaders Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Co-Leaders (Optional)</Text>
            <Text style={styles.sectionDescription}>
              Propose additional leaders for your group
            </Text>

            {/* Leader Search Input */}
            <View style={styles.searchContainer}>
              <Ionicons
                name="search"
                size={20}
                color="#999"
                style={styles.searchIcon}
              />
              <TextInput
                style={styles.searchInput}
                placeholder="Search by name or email..."
                value={leaderSearchQuery}
                onChangeText={setLeaderSearchQuery}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {leaderSearchQuery.length > 0 && (
                <TouchableOpacity
                  onPress={() => setLeaderSearchQuery("")}
                  style={styles.clearButton}
                >
                  <Ionicons name="close-circle" size={20} color="#999" />
                </TouchableOpacity>
              )}
            </View>

            {/* Search Results */}
            {isSearchingLeaders && (
              <View style={styles.searchingContainer}>
                <ActivityIndicator size="small" color="#007AFF" />
                <Text style={styles.searchingText}>Searching...</Text>
              </View>
            )}

            {debouncedLeaderSearch.length >= 2 &&
              !isSearchingLeaders &&
              leaderSearchResults &&
              leaderSearchResults.length > 0 && (
                <View style={styles.searchResults}>
                  {leaderSearchResults.map((leader) => (
                    <TouchableOpacity
                      key={leader.id}
                      style={styles.searchResultCard}
                      onPress={() => handleAddLeader(leader)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.leaderAvatar}>
                        {leader.profilePhoto ? (
                          <Image
                            source={{ uri: leader.profilePhoto }}
                            style={styles.leaderAvatarImage}
                          />
                        ) : (
                          <Text style={styles.leaderAvatarText}>
                            {getInitials(leader.firstName, leader.lastName)}
                          </Text>
                        )}
                      </View>
                      <View style={styles.leaderInfo}>
                        <Text style={styles.leaderName}>
                          {leader.firstName} {leader.lastName}
                        </Text>
                      </View>
                      <Ionicons name="add-circle" size={24} color="#007AFF" />
                    </TouchableOpacity>
                  ))}
                </View>
              )}

            {debouncedLeaderSearch.length >= 2 &&
              !isSearchingLeaders &&
              (!leaderSearchResults || leaderSearchResults.length === 0) && (
                <Text style={styles.noResultsText}>
                  No members found matching "{debouncedLeaderSearch}"
                </Text>
              )}

            {/* Selected Leaders */}
            {selectedLeaders.length > 0 && (
              <View style={styles.selectedLeadersContainer}>
                <Text style={styles.selectedLeadersLabel}>
                  Proposed Co-Leaders ({selectedLeaders.length})
                </Text>
                {selectedLeaders.map((leader) => (
                  <View key={leader.id} style={styles.selectedLeaderCard}>
                    <View style={styles.leaderAvatar}>
                      {leader.profilePhoto ? (
                        <Image
                          source={{ uri: leader.profilePhoto }}
                          style={styles.leaderAvatarImage}
                        />
                      ) : (
                        <Text style={styles.leaderAvatarText}>
                          {getInitials(leader.firstName, leader.lastName)}
                        </Text>
                      )}
                    </View>
                    <View style={styles.leaderInfo}>
                      <Text style={styles.leaderName}>
                        {leader.firstName} {leader.lastName}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => handleRemoveLeader(leader.id)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Ionicons
                        name="close-circle"
                        size={24}
                        color="#FF3B30"
                      />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Location Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Location (Optional)</Text>

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
              placeholder="Apt, suite, etc."
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

            {hasAddressWithoutZip && (
              <View style={styles.locationWarning}>
                <Ionicons name="warning" size={20} color="#F59E0B" />
                <Text style={styles.locationWarningText}>
                  Add a valid ZIP code so your group appears on the map
                </Text>
              </View>
            )}
          </View>

          {/* Meeting Schedule Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Meeting Schedule (Optional)</Text>

            <Controller
              name="proposed_start_day"
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
                  error={errors.proposed_start_day?.message}
                />
              )}
            />

            <FormInput
              name="default_start_time"
              control={control}
              label="Start Time (24-hour format)"
              error={errors.default_start_time}
              placeholder="e.g. 19:00"
            />

            <FormInput
              name="default_end_time"
              control={control}
              label="End Time (24-hour format)"
              error={errors.default_end_time}
              placeholder="e.g. 21:00"
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
              disabled={isSubmitting || isRequesting || hasPendingRequest}
              loading={isSubmitting || isRequesting}
              style={styles.submitButton}
            >
              Submit Request
            </Button>

            <Button
              onPress={() => router.back()}
              variant="secondary"
              disabled={isSubmitting || isRequesting}
              style={styles.cancelButton}
            >
              Cancel
            </Button>
          </View>
        </ScrollView>
      </View>
    </UserRoute>
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
  infoBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#EFF6FF",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    gap: 12,
  },
  infoBannerText: {
    flex: 1,
    fontSize: 14,
    color: "#1E40AF",
    lineHeight: 20,
  },
  warningBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FEF3C7",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    gap: 12,
  },
  warningBannerText: {
    flex: 1,
    fontSize: 14,
    color: "#92400E",
    lineHeight: 20,
    fontWeight: "500",
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
    marginBottom: 20,
  },
  sectionDescription: {
    fontSize: 14,
    color: "#666",
    marginTop: -12,
    marginBottom: 16,
  },
  groupTypeDescription: {
    backgroundColor: "#F0FDF4",
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    marginTop: -8,
  },
  groupTypeDescriptionText: {
    fontSize: 14,
    color: "#166534",
    lineHeight: 20,
  },
  textArea: {
    height: 100,
    textAlignVertical: "top",
  },
  buttonContainer: {
    gap: 12,
    marginTop: 8,
  },
  submitButton: {
    width: "100%",
  },
  cancelButton: {
    width: "100%",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F5F5F5",
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
    color: "#333",
  },
  clearButton: {
    padding: 4,
  },
  searchingContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  searchingText: {
    marginLeft: 8,
    fontSize: 14,
    color: "#666",
  },
  searchResults: {
    marginBottom: 16,
  },
  searchResultCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F9F9F9",
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  leaderAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#E5E5E5",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  leaderAvatarImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  leaderAvatarText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#666",
  },
  leaderInfo: {
    flex: 1,
  },
  leaderName: {
    fontSize: 16,
    fontWeight: "500",
    color: "#333",
  },
  noResultsText: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    paddingVertical: 12,
  },
  selectedLeadersContainer: {
    marginTop: 8,
  },
  selectedLeadersLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 12,
  },
  selectedLeaderCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E8F4FD",
    borderRadius: 10,
    padding: 12,
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
});
