import React, { useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Switch,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { uploadAsync, FileSystemUploadType } from "expo-file-system/legacy";
import { useQuery as useConvexQuery, useMutation as useConvexMutation, api, convexVanilla, useAuthenticatedMutation, useAuthenticatedAction } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useGroupDetails } from "../../groups/hooks/useGroupDetails";
import { DatePicker } from "@components/ui/DatePicker";
import { MultiDateCalendarPicker } from "@components/ui/MultiDateCalendarPicker";
import { ImagePickerComponent } from "@components/ui/ImagePicker";
import {
  RsvpOptionsEditor,
  RsvpOption,
  DEFAULT_RSVP_OPTIONS,
} from "./RsvpOptionsEditor";
import { VisibilitySelector, VisibilityLevel } from "./VisibilitySelector";
import { useLeaderGroups } from "@features/events/hooks/useCommunityEvents";
import { ShareToChatModal } from "./ShareToChatModal";
import { ConfirmModal } from "@components/ui/ConfirmModal";
import { getGroupCoordinates, geocodeAddressAsync } from "../../groups/utils/geocodeLocation";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useAuth } from "@providers/AuthProvider";
import { formatError } from "@/utils/error-handling";
import { useGroupTypes } from "../../admin/hooks/useGroupTypes";
import { DragHandle } from "@components/ui/DragHandle";
import { useTheme } from "@hooks/useTheme";
import { showEditScopePrompt, type EditScope } from "@components/ui/EditScopeModal";
import { SeriesBadge } from "@components/ui/SeriesBadge";

interface CreateMeetingInput {
  scheduledAt: string;
  title?: string;
  meetingType?: number;
  meetingLink?: string;
  locationOverride?: string;
  note?: string;
  coverImage?: string;
  rsvpEnabled?: boolean;
  rsvpOptions?: RsvpOption[];
  visibility?: VisibilityLevel;
}

export function CreateEventScreen() {
  const { colors } = useTheme();
  // All hooks must be called at the top level, before any early returns
  const { group_id, event_id: eventIdParam, hostingGroupId } = useLocalSearchParams<{
    group_id?: string;
    event_id?: string;
    hostingGroupId?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { primaryColor } = useCommunityTheme();
  const { token, user, community } = useAuth();

  // Check if user is a community admin
  const isAdmin = user?.is_admin === true;

  // Determine if we're in unified mode (no group_id in route) vs legacy mode
  const isUnifiedMode = !group_id;

  // Community-wide event toggle should only show for admins in unified mode (not editing)
  const canCreateCommunityWide = isAdmin && isUnifiedMode;

  // Fetch leader groups for unified mode dropdown
  const { data: leaderGroups, isLoading: isLoadingLeaderGroups } = useLeaderGroups();

  // Fetch group types for community-wide event creation (only for admins)
  const { groupTypes, isLoading: isLoadingGroupTypes } = useGroupTypes();

  // Community-wide event state
  const [isCommunityWideEnabled, setIsCommunityWideEnabled] = useState(false);
  const [selectedGroupTypeId, setSelectedGroupTypeId] = useState<string | null>(null);
  const [isGroupTypeDropdownOpen, setIsGroupTypeDropdownOpen] = useState(false);

  // Get selected group type for display
  const selectedGroupType = useMemo(() => {
    if (!selectedGroupTypeId || !groupTypes) return null;
    return groupTypes.find(gt => gt.id === selectedGroupTypeId) || null;
  }, [selectedGroupTypeId, groupTypes]);

  // Get count of active groups for selected type
  const groupCountForType = useConvexQuery(
    api.functions.meetings.communityEvents.countGroupsByType,
    isCommunityWideEnabled && selectedGroupTypeId && community?.id
      ? {
          communityId: community.id as Id<"communities">,
          groupTypeId: selectedGroupTypeId as Id<"groupTypes">,
        }
      : "skip"
  );

  // Form state - must be declared before any conditional logic
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null);
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [isOnline, setIsOnline] = useState(false);
  const [meetingLink, setMeetingLink] = useState("");
  const [note, setNote] = useState("");
  const [coverImage, setCoverImage] = useState<string | undefined>();
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  // Convex action for getting R2 presigned upload URL
  const getR2UploadUrl = useAuthenticatedAction(api.functions.uploads.getR2UploadUrl);
  const [errors, setErrors] = useState<{ scheduledAt?: string; hostingGroup?: string; groupType?: string }>({});
  const [rsvpEnabled, setRsvpEnabled] = useState(true);
  const [rsvpOptions, setRsvpOptions] =
    useState<RsvpOption[]>(DEFAULT_RSVP_OPTIONS);
  const [visibility, setVisibility] = useState<VisibilityLevel>("public");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(hostingGroupId || null);
  const [isGroupDropdownOpen, setIsGroupDropdownOpen] = useState(false);

  // Series state
  const [isSeriesMode, setIsSeriesMode] = useState(false);
  const [seriesName, setSeriesName] = useState("");
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);
  const [timeOfDay, setTimeOfDay] = useState<Date | null>(null);
  const [existingSeriesName, setExistingSeriesName] = useState<string | null>(null);
  const [isSeriesNameDropdownOpen, setIsSeriesNameDropdownOpen] = useState(false);

  // Query existing series names for community-wide series
  const existingSeriesNames = useConvexQuery(
    api.functions.eventSeries.listSeriesNamesByGroupType,
    isCommunityWideEnabled && isSeriesMode && selectedGroupTypeId && community?.id
      ? {
          communityId: community.id as Id<"communities">,
          groupTypeId: selectedGroupTypeId as Id<"groupTypes">,
        }
      : "skip"
  );

  // Series linking state (edit mode)
  const [newSeriesNameInput, setNewSeriesNameInput] = useState("");
  const [isCreatingNewSeries, setIsCreatingNewSeries] = useState(false);
  const [isSeriesDropdownOpen, setIsSeriesDropdownOpen] = useState(false);
  const [isSeriesLinking, setIsSeriesLinking] = useState(false);

  // Share to chat modal state
  const [showShareModal, setShowShareModal] = useState(false);
  const [pendingMeetingId, setPendingMeetingId] = useState<string | null>(null);

  // Past date confirmation modal state (for admins only)
  const [showPastDateModal, setShowPastDateModal] = useState(false);

  // Location geocoding validation state
  const [locationCanBeGeocoded, setLocationCanBeGeocoded] = useState<boolean | null>(null);
  const [isCheckingLocation, setIsCheckingLocation] = useState(false);

  // The effective group ID is either from route params or selected
  const effectiveGroupId = group_id || selectedGroupId;

  // Parse meetingId from event_id parameter if editing
  let meetingId: string | null = null;
  if (eventIdParam?.startsWith("id-")) {
    const afterPrefix = eventIdParam.replace("id-", "");
    const separatorIndex = afterPrefix.indexOf("|");
    if (separatorIndex > 0) {
      meetingId = afterPrefix.substring(0, separatorIndex);
    }
  }

  const isEditMode = !!meetingId;

  // Fetch group details to get group type name
  const { data: groupDetails } = useGroupDetails(effectiveGroupId ?? undefined);
  const groupTypeName = groupDetails?.group_type_name || "Event";

  // Get selected group info from leaderGroups for display
  const selectedGroup = useMemo(() => {
    if (!selectedGroupId || !leaderGroups) return null;
    return leaderGroups.find(g => g && g.id === selectedGroupId) || null;
  }, [selectedGroupId, leaderGroups]);

  // Fetch existing meeting data if editing (using Convex)
  const meetingData = useConvexQuery(
    api.functions.meetings.queries.getWithDetails,
    isEditMode && !!meetingId ? { meetingId: meetingId as Id<"meetings"> } : "skip"
  );
  const meeting = meetingData ?? undefined;
  const isLoadingMeeting = isEditMode && !!meetingId && meetingData === undefined;

  // Query existing series for the group (edit mode series linking)
  const editGroupId = effectiveGroupId || (meeting as any)?.groupId;
  const groupSeriesList = useConvexQuery(
    api.functions.eventSeries.listByGroup,
    isEditMode && editGroupId
      ? { groupId: editGroupId as Id<"groups">, status: "active" }
      : "skip"
  );

  // Initialize form from meeting data when editing
  useEffect(() => {
    if (meeting && isEditMode) {
      if (meeting.scheduledAt) {
        // Convex stores scheduledAt as a timestamp number
        setScheduledAt(new Date(meeting.scheduledAt));
      }
      setTitle(meeting.title || "");
      setLocation(meeting.locationOverride || "");
      setIsOnline(meeting.meetingType === 2); // 2 = online
      setMeetingLink(meeting.meetingLink || "");
      setNote(meeting.note || "");
      setCoverImage(meeting.coverImage || undefined);

      // Initialize RSVP fields
      if (meeting.rsvpEnabled !== undefined) {
        setRsvpEnabled(meeting.rsvpEnabled);
      }
      if (meeting.rsvpOptions && Array.isArray(meeting.rsvpOptions)) {
        setRsvpOptions(meeting.rsvpOptions as unknown as RsvpOption[]);
      }
      if (meeting.visibility) {
        setVisibility(meeting.visibility as VisibilityLevel);
      }
    }
  }, [meeting, isEditMode]);

  // Debounced geocoding check for location field
  useEffect(() => {
    // Only check if location is filled and event is in-person
    if (!location.trim() || isOnline) {
      setLocationCanBeGeocoded(null);
      return;
    }

    const timeoutId = setTimeout(async () => {
      setIsCheckingLocation(true);
      try {
        // First try sync geocoding (zip code extraction)
        const syncCoords = getGroupCoordinates({ location: location.trim() });
        if (syncCoords) {
          setLocationCanBeGeocoded(true);
          setIsCheckingLocation(false);
          return;
        }

        // Try async geocoding
        const asyncCoords = await geocodeAddressAsync(location.trim());
        setLocationCanBeGeocoded(!!asyncCoords);
      } catch (error) {
        setLocationCanBeGeocoded(false);
      }
      setIsCheckingLocation(false);
    }, 800); // Debounce for 800ms

    return () => clearTimeout(timeoutId);
  }, [location, isOnline]);

  // Convex mutations for meetings - use authenticated versions that auto-inject token
  const createMeetingMutation = useAuthenticatedMutation(api.functions.meetings.index.create);
  const updateMeetingMutation = useAuthenticatedMutation(api.functions.meetings.index.update);
  const cancelMeetingMutation = useAuthenticatedMutation(api.functions.meetings.index.cancel);
  const cancelCommunityWideEventMutation = useAuthenticatedMutation(api.functions.communityWideEvents.cancel);
  const createCommunityWideEventMutation = useAuthenticatedMutation(api.functions.meetings.communityEvents.createCommunityWideEvent);
  const createSeriesEventsMutation = useAuthenticatedMutation(api.functions.meetings.index.createSeriesEvents);
  const createCommunityWideSeriesMutation = useAuthenticatedMutation(api.functions.communityWideEvents.createSeries);
  const addMeetingToSeriesMutation = useAuthenticatedMutation(api.functions.eventSeries.addMeetingToSeries);
  const removeMeetingFromSeriesMutation = useAuthenticatedMutation(api.functions.eventSeries.removeMeetingFromSeries);
  const createSeriesFromMeetingsMutation = useAuthenticatedMutation(api.functions.eventSeries.createSeriesFromMeetings);
  const postToChatMutationFn = useAuthenticatedMutation(api.functions.meetings.index.postToChat);

  // Mutation state tracking
  const [isCreating, setIsCreating] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isPostingToChat, setIsPostingToChat] = useState(false);
  const [isCreatingCommunityWide, setIsCreatingCommunityWide] = useState(false);

  // Show the share to chat modal
  const showShareToChatModal = (eventMeetingId: string) => {
    setPendingMeetingId(eventMeetingId);
    setShowShareModal(true);
  };

  // Handle sending the event to chat with a message
  const handleSendToChat = async (message: string) => {
    if (!pendingMeetingId) return;
    setIsPostingToChat(true);
    try {
      await postToChatMutationFn({
        meetingId: pendingMeetingId as Id<"meetings">,
        message,
      });
      setShowShareModal(false);
      setPendingMeetingId(null);
      router.back();
    } catch (error: any) {
      Alert.alert(
        "Error",
        error.message || "Failed to post event to chat. Please try again."
      );
    } finally {
      setIsPostingToChat(false);
    }
  };

  // Handle skipping the share to chat
  const handleSkipShare = () => {
    setShowShareModal(false);
    setPendingMeetingId(null);
    router.back();
  };

  // Wrapper for create mutation with state tracking
  // Note: useAuthenticatedMutation auto-injects the token
  const createMeeting = {
    mutate: async (data: { groupId: string; scheduledAt: string; title?: string; meetingType?: number; meetingLink?: string; locationOverride?: string; note?: string; coverImage?: string; rsvpEnabled?: boolean; rsvpOptions?: RsvpOption[]; visibility?: VisibilityLevel }) => {
      setIsCreating(true);
      try {
        const newMeetingId = await createMeetingMutation({
          groupId: data.groupId as Id<"groups">,
          scheduledAt: new Date(data.scheduledAt).getTime(),
          title: data.title,
          meetingType: data.meetingType ?? 1,
          meetingLink: data.meetingLink,
          locationOverride: data.locationOverride,
          note: data.note,
          coverImage: data.coverImage,
          rsvpEnabled: data.rsvpEnabled,
          rsvpOptions: data.rsvpOptions,
          visibility: data.visibility,
        });
        // Convex automatically updates queries, so no need to invalidate
        // Show the share to chat modal
        showShareToChatModal(newMeetingId);
      } catch (error: any) {
        Alert.alert("Error", formatError(error, "Failed to create event"));
      } finally {
        setIsCreating(false);
      }
    },
    isPending: isCreating,
  };

  // Wrapper for update mutation with state tracking
  // Note: useAuthenticatedMutation auto-injects the token
  const updateMeeting = {
    mutate: async (data: { meetingId: string; scheduledAt?: string; title?: string; meetingType?: number; meetingLink?: string; locationOverride?: string; note?: string; coverImage?: string; rsvpEnabled?: boolean; rsvpOptions?: RsvpOption[]; visibility?: VisibilityLevel; notifyGuests?: boolean }) => {
      setIsUpdating(true);
      try {
        await updateMeetingMutation({
          meetingId: data.meetingId as Id<"meetings">,
          scheduledAt: data.scheduledAt ? new Date(data.scheduledAt).getTime() : undefined,
          title: data.title,
          meetingType: data.meetingType,
          meetingLink: data.meetingLink,
          locationOverride: data.locationOverride,
          note: data.note,
          coverImage: data.coverImage,
          rsvpEnabled: data.rsvpEnabled,
          rsvpOptions: data.rsvpOptions,
          visibility: data.visibility,
        });
        // Convex automatically updates queries
        router.back();
      } catch (error: any) {
        Alert.alert("Error", formatError(error, "Failed to update event"));
      } finally {
        setIsUpdating(false);
      }
    },
    isPending: isUpdating,
  };

  // Wrapper for cancel mutation with state tracking
  // Note: useAuthenticatedMutation auto-injects the token
  const cancelMeeting = {
    mutate: async (data: { meetingId: string }) => {
      setIsCancelling(true);
      try {
        await cancelMeetingMutation({
          meetingId: data.meetingId as Id<"meetings">,
        });
        // Convex automatically updates queries
        Alert.alert(
          "Event Cancelled",
          "This event has been cancelled.",
          [{ text: "OK", onPress: () => router.back() }]
        );
      } catch (error: any) {
        Alert.alert("Error", formatError(error, "Failed to cancel event"));
      } finally {
        setIsCancelling(false);
      }
    },
    isPending: isCancelling,
  };

  // Post to chat mutation state (for the modal)
  const postToChatMutation = {
    isPending: isPostingToChat,
  };

  const handleCancelEvent = () => {
    if (!meetingId) return;

    const hasSeries = !!meeting?.seriesId;
    const isCommunityWide = !!meeting?.communityWideEventId;

    if (!hasSeries && !isCommunityWide) {
      // Simple case: no series, no community-wide
      Alert.alert(
        "Cancel Event",
        "Are you sure you want to cancel this event? This action cannot be undone and all attendees will be notified.",
        [
          { text: "Keep Event", style: "cancel" },
          {
            text: "Cancel Event",
            style: "destructive",
            onPress: () => cancelMeeting.mutate({ meetingId }),
          },
        ]
      );
      return;
    }

    // Show scope selection for series/community-wide events
    showEditScopePrompt({
      isCommunityWide,
      isInSeries: hasSeries,
      actionLabel: "Cancel",
      onSelect: (scope: EditScope) => {
        const scopeLabel =
          scope === "all_in_series"
            ? "all events in this series"
            : scope === "this_date_all_groups"
              ? "this event for all groups"
              : "this event";

        Alert.alert(
          "Cancel Event",
          `Are you sure you want to cancel ${scopeLabel}? This cannot be undone.`,
          [
            { text: "Keep", style: "cancel" },
            {
              text: "Cancel Event",
              style: "destructive",
              onPress: async () => {
                setIsCancelling(true);
                try {
                  if (isCommunityWide && (scope === "this_date_all_groups" || scope === "all_in_series") && meeting?.communityWideEventId) {
                    // Use community-wide cancel API for cross-group scopes
                    await cancelCommunityWideEventMutation({
                      communityWideEventId: meeting.communityWideEventId as Id<"communityWideEvents">,
                      scope,
                    });
                  } else {
                    await cancelMeetingMutation({
                      meetingId: meetingId as Id<"meetings">,
                      scope: scope === "all_in_series" ? "all_in_series" : undefined,
                    });
                  }
                  Alert.alert("Cancelled", "Event(s) cancelled.", [
                    { text: "OK", onPress: () => router.back() },
                  ]);
                } catch (error: any) {
                  Alert.alert("Error", formatError(error, "Failed to cancel"));
                } finally {
                  setIsCancelling(false);
                }
              },
            },
          ]
        );
      },
    });
  };

  const validateForm = (): boolean => {
    const newErrors: { scheduledAt?: string; hostingGroup?: string; groupType?: string; seriesName?: string } = {};

    if (isSeriesMode) {
      // Series mode validation
      if (selectedDates.length < 1) {
        newErrors.scheduledAt = "Select at least 1 date";
      }
      if (!timeOfDay) {
        newErrors.scheduledAt = "Time is required";
      }
      if (!seriesName.trim() && !existingSeriesName) {
        newErrors.seriesName = "Series name is required";
      }
    } else {
      if (!scheduledAt) {
        newErrors.scheduledAt = "Date and time is required";
      } else if (scheduledAt < new Date() && !isAdmin) {
        // Non-admins cannot create events in the past
        newErrors.scheduledAt = "Event date cannot be in the past";
      }
    }
    // Note: Admins can create past events but will see a confirmation modal

    // For community-wide events, require a group type
    if (isCommunityWideEnabled) {
      if (!selectedGroupTypeId) {
        newErrors.groupType = "Please select a group type";
      }
    } else if (isUnifiedMode && !selectedGroupId && !isEditMode) {
      // In unified mode (non-community-wide), require a hosting group to be selected
      newErrors.hostingGroup = "Please select a hosting group";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Check if the scheduled date is in the past
  const isDateInPast = (): boolean => {
    if (!scheduledAt) return false;
    return scheduledAt < new Date();
  };

  /**
   * Upload cover image to R2 if it's a local file URI
   * Returns the R2 storage path if upload succeeds, or the original URL if already a remote URL
   */
  const uploadCoverImageToR2 = async (imageUri: string): Promise<string> => {
    // If it's already an http URL, return as-is
    if (imageUri.startsWith('http://') || imageUri.startsWith('https://')) {
      return imageUri;
    }

    // It's a local file URI - need to upload to R2
    setIsUploadingImage(true);
    try {
      const fileName = imageUri.split('/').pop() || 'event-cover.jpg';
      const cleanFileName = fileName.split('?')[0];
      const fileExtension = cleanFileName.split('.').pop()?.toLowerCase() || 'jpg';
      const contentType = `image/${fileExtension === 'jpg' ? 'jpeg' : fileExtension}`;

      // Get R2 presigned URL from Convex
      const { uploadUrl, storagePath } = await getR2UploadUrl({
        fileName: cleanFileName,
        contentType,
        folder: 'meetings',
      });

      // Upload to R2
      if (Platform.OS === 'web') {
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
        const uploadResult = await uploadAsync(uploadUrl, imageUri, {
          httpMethod: 'PUT',
          uploadType: FileSystemUploadType.BINARY_CONTENT,
          headers: {
            'Content-Type': contentType,
          },
        });
        if (uploadResult.status < 200 || uploadResult.status >= 300) {
          throw new Error(`R2 upload failed: ${uploadResult.status}`);
        }
      }

      return storagePath; // Return the R2 storage path (e.g., "r2:meetings/uuid-filename.jpg")
    } finally {
      setIsUploadingImage(false);
    }
  };

  // The actual submission logic, called after all validations and confirmations
  const proceedWithSubmit = async () => {
    try {
      // Upload cover image to R2 if it's a local file (not already a remote URL)
      let finalCoverImage = coverImage;
      console.log('[CreateEvent] coverImage state:', coverImage);
      if (coverImage && !coverImage.startsWith('http://') && !coverImage.startsWith('https://')) {
        console.log('[CreateEvent] Uploading local image to R2...');
        finalCoverImage = await uploadCoverImageToR2(coverImage);
        console.log('[CreateEvent] R2 upload complete, path:', finalCoverImage);
      }

      const data: CreateMeetingInput = {
        scheduledAt: isSeriesMode
          ? new Date().toISOString() // Placeholder — series paths use selectedDates + timeOfDay directly
          : scheduledAt!.toISOString(),
        title: title.trim() || undefined,
        meetingType: isOnline ? 2 : 1, // 1 = In-Person, 2 = Online
        meetingLink:
          isOnline && meetingLink.trim() ? meetingLink.trim() : undefined,
        locationOverride:
          !isOnline && location.trim() ? location.trim() : undefined,
        note: note.trim() || undefined,
        coverImage: finalCoverImage || undefined,
        rsvpEnabled: rsvpEnabled,
        rsvpOptions: rsvpOptions.filter((opt) => opt.enabled),
        visibility: visibility,
      };

      if (isEditMode && meetingId) {
        const hasSeries = !!meeting?.seriesId;
        const isCommunityWide = !!meeting?.communityWideEventId;

        // Determine edit scope
        const performUpdate = (scope?: EditScope) => {
          const updateData = scope && scope !== "this_only"
            ? { meetingId, ...data, scope }
            : { meetingId, ...data };

          // Check if time or location changed
          const originalScheduledAt = meeting?.scheduledAt ? new Date(meeting.scheduledAt).toISOString() : null;
          const newScheduledAt = data.scheduledAt;
          const originalLocation = meeting?.locationOverride || '';
          const newLocation = data.locationOverride || '';

          const timeChanged = originalScheduledAt !== newScheduledAt;
          const locationChanged = newLocation !== originalLocation;

          if (timeChanged || locationChanged) {
            promptToNotifyGuestsBeforeUpdate(meetingId, updateData, timeChanged, locationChanged);
          } else {
            updateMeeting.mutate(updateData);
          }
        };

        if (hasSeries || isCommunityWide) {
          showEditScopePrompt({
            isCommunityWide,
            isInSeries: hasSeries,
            actionLabel: "Edit",
            onSelect: performUpdate,
          });
        } else {
          performUpdate();
        }
      } else if (isSeriesMode && isCommunityWideEnabled && selectedGroupTypeId && community?.id) {
        // Create community-wide series (multiple dates across all groups of a type)
        setIsCreatingCommunityWide(true);
        try {
          const dates = selectedDates.map((date) => {
            const combined = new Date(date);
            combined.setHours(timeOfDay!.getHours(), timeOfDay!.getMinutes(), 0, 0);
            return combined.getTime();
          });

          const effectiveSeriesName = existingSeriesName || seriesName.trim();
          const result = await createCommunityWideSeriesMutation({
            communityId: community.id as Id<"communities">,
            groupTypeId: selectedGroupTypeId as Id<"groupTypes">,
            seriesName: effectiveSeriesName,
            dates,
            title: title.trim() || selectedGroupType?.name || "Event",
            meetingType: data.meetingType ?? 1,
            meetingLink: data.meetingLink,
            note: data.note,
            coverImage: finalCoverImage,
          });
          Alert.alert(
            "Series Created",
            `Created ${result.totalMeetingsCreated} events across ${selectedDates.length} dates`,
            [{ text: "OK", onPress: () => router.back() }]
          );
        } catch (error: any) {
          Alert.alert("Error", formatError(error, "Failed to create community-wide series"));
        } finally {
          setIsCreatingCommunityWide(false);
        }
      } else if (isSeriesMode && effectiveGroupId) {
        // Create series for a single group
        setIsCreating(true);
        try {
          const dates = selectedDates.map((date) => {
            const combined = new Date(date);
            combined.setHours(timeOfDay!.getHours(), timeOfDay!.getMinutes(), 0, 0);
            return combined.getTime();
          });

          const result = await createSeriesEventsMutation({
            groupId: effectiveGroupId as Id<"groups">,
            seriesName: seriesName.trim(),
            dates,
            title: title.trim() || undefined,
            meetingType: data.meetingType ?? 1,
            meetingLink: data.meetingLink,
            locationOverride: data.locationOverride,
            note: data.note,
            coverImage: finalCoverImage,
            rsvpEnabled: data.rsvpEnabled,
            rsvpOptions: data.rsvpOptions,
            visibility: data.visibility,
          });
          Alert.alert(
            "Series Created",
            `Created ${result.meetingIds.length} events in "${seriesName.trim()}" series`,
            [{ text: "OK", onPress: () => router.back() }]
          );
        } catch (error: any) {
          Alert.alert("Error", formatError(error, "Failed to create event series"));
        } finally {
          setIsCreating(false);
        }
      } else if (isCommunityWideEnabled && selectedGroupTypeId && community?.id) {
        // Create community-wide event
        setIsCreatingCommunityWide(true);
        console.log('[CreateEvent] Creating community-wide event with coverImage:', finalCoverImage);
        try {
          const result = await createCommunityWideEventMutation({
            communityId: community.id as Id<"communities">,
            groupTypeId: selectedGroupTypeId as Id<"groupTypes">,
            title: title.trim() || selectedGroupType?.name || "Event",
            scheduledAt: new Date(data.scheduledAt).getTime(),
            meetingType: data.meetingType ?? 1,
            meetingLink: data.meetingLink,
            note: data.note,
            visibility: data.visibility,
            coverImage: finalCoverImage,
            rsvpEnabled: data.rsvpEnabled,
            rsvpOptions: data.rsvpOptions,
          });
          Alert.alert(
            "Events Created",
            `Created events for ${result.groupCount} ${result.groupTypeName} groups`,
            [{ text: "OK", onPress: () => router.back() }]
          );
        } catch (error: any) {
          Alert.alert("Error", formatError(error, "Failed to create community-wide event"));
        } finally {
          setIsCreatingCommunityWide(false);
        }
      } else if (effectiveGroupId) {
        createMeeting.mutate({ groupId: effectiveGroupId, ...data });
      }
    } catch (error: any) {
      Alert.alert("Upload Error", formatError(error, "Failed to upload cover image"));
    }
  };

  // Main submit handler - validates and shows confirmation modal for past dates
  const handleSubmit = async () => {
    if (!validateForm()) return;

    // For admins creating NEW events in the past, show confirmation modal
    // Skip if editing an existing event that already had a past date
    const originalDateWasInPast =
      isEditMode && meeting?.scheduledAt && new Date(meeting.scheduledAt) < new Date();
    if (isAdmin && isDateInPast() && !originalDateWasInPast) {
      setShowPastDateModal(true);
      return;
    }

    await proceedWithSubmit();
  };

  // Prompt user about notifying guests BEFORE making the update
  const promptToNotifyGuestsBeforeUpdate = async (
    eventMeetingId: string,
    data: CreateMeetingInput & { scope?: EditScope; meetingId?: string },
    timeChanged: boolean,
    locationChanged: boolean
  ) => {
    try {
      // Check if there are any "Going" RSVPs before prompting (using Convex)
      const rsvpData = await convexVanilla.query(api.functions.meetingRsvps.list, {
        meetingId: eventMeetingId as Id<"meetings">,
      });
      // Find the count for option 1 (Going) from the grouped response
      const goingRsvp = rsvpData?.rsvps?.find((r) => r.option.id === 1);
      const goingCount = goingRsvp?.count || 0;

      if (goingCount === 0) {
        // No guests to notify, just update
        updateMeeting.mutate({ meetingId: eventMeetingId, ...data });
        return;
      }

      // Build change description for the prompt
      const changeDescriptions: string[] = [];
      if (timeChanged) changeDescriptions.push("time");
      if (locationChanged) changeDescriptions.push("location");
      const changeText = changeDescriptions.join(" and ");

      Alert.alert(
        "Notify Guests?",
        `You changed the ${changeText}. Would you like to notify ${goingCount} guest${goingCount > 1 ? 's' : ''} who RSVP'd 'Going'?`,
        [
          {
            text: "No",
            style: "cancel",
            onPress: () => {
              // Update without notification
              updateMeeting.mutate({ meetingId: eventMeetingId, ...data });
            },
          },
          {
            text: "Yes, Notify",
            onPress: () => {
              // Update WITH notification
              updateMeeting.mutate({ meetingId: eventMeetingId, ...data, notifyGuests: true });
            },
          },
        ]
      );
    } catch (error) {
      console.error("Failed to check RSVPs:", error);
      // Fall back to showing prompt anyway
      Alert.alert(
        "Notify Guests?",
        "Would you like to notify guests who RSVP'd 'Going' about this change?",
        [
          {
            text: "No",
            style: "cancel",
            onPress: () => {
              updateMeeting.mutate({ meetingId: eventMeetingId, ...data });
            },
          },
          {
            text: "Yes, Notify",
            onPress: () => {
              updateMeeting.mutate({ meetingId: eventMeetingId, ...data, notifyGuests: true });
            },
          },
        ]
      );
    }
  };

  // Handle confirmation of past date event creation
  const handleConfirmPastDate = async () => {
    setShowPastDateModal(false);
    // Proceed with submission directly (bypassing the past date check)
    await proceedWithSubmit();
  };

  // Handle cancellation of past date event creation
  const handleCancelPastDate = () => {
    setShowPastDateModal(false);
  };

  const isSubmitting =
    createMeeting.isPending ||
    updateMeeting.isPending ||
    postToChatMutation.isPending ||
    cancelMeeting.isPending ||
    isUploadingImage ||
    isCreatingCommunityWide;

  // Show loading state while fetching meeting data for edit
  if (isEditMode && isLoadingMeeting) {
    return (
      <>
        <View style={[styles.container, { paddingTop: insets.top + 16, backgroundColor: colors.backgroundSecondary }]}>
          <DragHandle />
          <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => router.back()}
            >
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
            <View style={styles.headerContent}>
              <Text style={[styles.headerTitle, { color: colors.text }]}>Edit Event</Text>
            </View>
          </View>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={primaryColor} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading event details...</Text>
          </View>
        </View>
      </>
    );
  }

  // Show error state if meeting not found
  if (isEditMode && !meeting && !isLoadingMeeting) {
    return (
      <>
        <View style={[styles.container, { paddingTop: insets.top + 16, backgroundColor: colors.backgroundSecondary }]}>
          <DragHandle />
          <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => router.back()}
            >
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
            <View style={styles.headerContent}>
              <Text style={[styles.headerTitle, { color: colors.text }]}>Edit Event</Text>
            </View>
          </View>
          <View style={styles.errorContainer}>
            <Text style={[styles.errorText, { color: colors.textSecondary }]}>Event not found</Text>
            <TouchableOpacity
              style={[styles.backButtonError, { backgroundColor: primaryColor }]}
              onPress={() => router.back()}
            >
              <Text style={[styles.backButtonErrorText, { color: '#fff' }]}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </>
    );
  }

  return (
    <>
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: colors.backgroundSecondary }]}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <DragHandle />
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 16, backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <TouchableOpacity
            testID="back-button"
            style={styles.backButton}
            onPress={() => router.back()}
            disabled={isSubmitting}
          >
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerContent}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>
              {isEditMode ? "Edit Event" : "Create Event"}
            </Text>
          </View>
        </View>

        {/* Content */}
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentContainer}
          keyboardShouldPersistTaps="handled"
        >
          {/* Community-Wide Event Toggle - only show for admins in unified mode */}
          {canCreateCommunityWide && !isEditMode && (
            <View style={[styles.communityWideSection, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
              <View style={styles.communityWideToggleRow}>
                <View style={styles.communityWideToggleLabel}>
                  <Text style={[styles.label, { color: colors.text }]}>Create for all</Text>
                </View>
                <Switch
                  value={isCommunityWideEnabled}
                  onValueChange={(value) => {
                    setIsCommunityWideEnabled(value);
                    // Reset selections when toggling
                    if (value) {
                      setSelectedGroupId(null);
                      setIsGroupDropdownOpen(false);
                    } else {
                      setSelectedGroupTypeId(null);
                      setIsGroupTypeDropdownOpen(false);
                    }
                    setErrors({});
                  }}
                  trackColor={{ false: colors.border, true: primaryColor }}
                  thumbColor={colors.textInverse}
                  disabled={isSubmitting}
                />
              </View>

              {/* Group Type Selector - only show when toggle is ON */}
              {isCommunityWideEnabled && (
                <View style={styles.groupTypeSelector}>
                  {isLoadingGroupTypes ? (
                    <View style={[styles.loadingDropdown, { backgroundColor: colors.surfaceSecondary }]}>
                      <ActivityIndicator size="small" color={primaryColor} />
                      <Text style={[styles.loadingDropdownText, { color: colors.textSecondary }]}>Loading group types...</Text>
                    </View>
                  ) : !groupTypes || groupTypes.length === 0 ? (
                    <View style={[styles.noGroupsContainer, { backgroundColor: colors.surfaceSecondary }]}>
                      <Text style={[styles.noGroupsText, { color: colors.destructive }]}>
                        No group types available.
                      </Text>
                    </View>
                  ) : (
                    <>
                      <TouchableOpacity
                        style={[
                          styles.dropdownButton,
                          { borderColor: colors.inputBorder, backgroundColor: colors.inputBackground },
                          errors.groupType && styles.dropdownButtonError,
                        ]}
                        onPress={() => setIsGroupTypeDropdownOpen(!isGroupTypeDropdownOpen)}
                        disabled={isSubmitting}
                      >
                        {selectedGroupType ? (
                          <Text style={[styles.selectedGroupName, { color: colors.text }]}>{selectedGroupType.name}</Text>
                        ) : (
                          <Text style={[styles.dropdownPlaceholder, { color: colors.inputPlaceholder }]}>Select group type</Text>
                        )}
                        <Ionicons
                          name={isGroupTypeDropdownOpen ? "chevron-up" : "chevron-down"}
                          size={20}
                          color={colors.textSecondary}
                        />
                      </TouchableOpacity>
                      {isGroupTypeDropdownOpen && (
                        <View style={[styles.dropdownList, { borderColor: colors.inputBorder, backgroundColor: colors.surface }]}>
                          {groupTypes.map((gt) => (
                            <TouchableOpacity
                              key={gt.id}
                              style={[
                                styles.dropdownItem,
                                { borderBottomColor: colors.borderLight },
                                selectedGroupTypeId === gt.id && [styles.dropdownItemSelected, { backgroundColor: colors.selectedBackground }],
                              ]}
                              onPress={() => {
                                setSelectedGroupTypeId(gt.id);
                                setIsGroupTypeDropdownOpen(false);
                                setErrors((prev) => ({ ...prev, groupType: undefined }));
                              }}
                            >
                              <Text
                                style={[
                                  styles.dropdownItemText,
                                  { color: colors.text },
                                  selectedGroupTypeId === gt.id && [styles.dropdownItemTextSelected, { color: primaryColor }],
                                ]}
                              >
                                {gt.name}
                              </Text>
                              <Text style={[styles.dropdownItemSubtext, { color: colors.textSecondary }]}>
                                {gt.groupCount} {gt.groupCount === 1 ? "group" : "groups"}
                              </Text>
                              {selectedGroupTypeId === gt.id && (
                                <Ionicons name="checkmark" size={18} color={primaryColor} />
                              )}
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
                      {errors.groupType && (
                        <Text style={styles.fieldErrorText}>{errors.groupType}</Text>
                      )}
                    </>
                  )}

                  {/* Show count of groups that will receive the event */}
                  {selectedGroupTypeId && groupCountForType !== undefined && (
                    <View style={[styles.groupCountInfo, { backgroundColor: colors.surfaceSecondary }]}>
                      <Ionicons name="information-circle" size={16} color={colors.link} />
                      <Text style={[styles.groupCountText, { color: colors.link }]}>
                        This will create events for {groupCountForType} {selectedGroupType?.name || "group"} groups
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          )}

          {/* Community-Wide Event Edit Warning */}
          {isEditMode && meeting?.communityWideEventId && !meeting?.isOverridden && (
            <View style={[styles.communityWideWarning, { backgroundColor: colors.surfaceSecondary, borderColor: colors.warning }]}>
              <View style={styles.communityWideWarningHeader}>
                <Ionicons name="globe-outline" size={20} color={colors.link} />
                <Text style={[styles.communityWideWarningTitle, { color: colors.text }]}>Community-wide event</Text>
              </View>
              <Text style={[styles.communityWideWarningText, { color: colors.textSecondary }]}>
                Editing will disconnect this event from community-wide updates. Future changes to the parent event won't affect this group's event.
              </Text>
            </View>
          )}

          {/* Hosting Group Selector - only show in unified mode when NOT creating community-wide event */}
          {isUnifiedMode && !isEditMode && !isCommunityWideEnabled && (
            <View style={styles.fieldContainer}>
              <Text style={[styles.label, { color: colors.text }]}>Hosting Group *</Text>
              {isLoadingLeaderGroups ? (
                <View style={[styles.loadingDropdown, { backgroundColor: colors.surfaceSecondary }]}>
                  <ActivityIndicator size="small" color={primaryColor} />
                  <Text style={[styles.loadingDropdownText, { color: colors.textSecondary }]}>Loading groups...</Text>
                </View>
              ) : !leaderGroups || leaderGroups.length === 0 ? (
                <View style={[styles.noGroupsContainer, { backgroundColor: colors.surfaceSecondary }]}>
                  <Text style={[styles.noGroupsText, { color: colors.destructive }]}>
                    You don't have permission to create events for any groups.
                  </Text>
                </View>
              ) : (
                <>
                  <TouchableOpacity
                    style={[
                      styles.dropdownButton,
                      { borderColor: colors.inputBorder, backgroundColor: colors.inputBackground },
                      errors.hostingGroup && styles.dropdownButtonError,
                    ]}
                    onPress={() => setIsGroupDropdownOpen(!isGroupDropdownOpen)}
                    disabled={isSubmitting}
                  >
                    {selectedGroup ? (
                      <View style={styles.selectedGroupRow}>
                        <Text style={[styles.selectedGroupName, { color: colors.text }]}>{selectedGroup.name}</Text>
                        <Text style={[styles.selectedGroupType, { color: colors.textSecondary }]}>{selectedGroup.groupTypeName}</Text>
                      </View>
                    ) : (
                      <Text style={[styles.dropdownPlaceholder, { color: colors.inputPlaceholder }]}>Select a group</Text>
                    )}
                    <Ionicons
                      name={isGroupDropdownOpen ? "chevron-up" : "chevron-down"}
                      size={20}
                      color={colors.textSecondary}
                    />
                  </TouchableOpacity>
                  {isGroupDropdownOpen && (
                    <View style={[styles.dropdownList, { borderColor: colors.inputBorder, backgroundColor: colors.surface }]}>
                      {leaderGroups.filter(Boolean).map((group) => (
                        <TouchableOpacity
                          key={group!.id}
                          style={[
                            styles.dropdownItem,
                            { borderBottomColor: colors.borderLight },
                            selectedGroupId === group!.id && [styles.dropdownItemSelected, { backgroundColor: colors.selectedBackground }],
                          ]}
                          onPress={() => {
                            setSelectedGroupId(group!.id);
                            setIsGroupDropdownOpen(false);
                            setErrors((prev) => ({ ...prev, hostingGroup: undefined }));
                          }}
                        >
                          <Text
                            style={[
                              styles.dropdownItemText,
                              { color: colors.text },
                              selectedGroupId === group!.id && [styles.dropdownItemTextSelected, { color: primaryColor }],
                            ]}
                          >
                            {group!.name}
                          </Text>
                          <Text style={[styles.dropdownItemSubtext, { color: colors.textSecondary }]}>{group!.groupTypeName}</Text>
                          {selectedGroupId === group!.id && (
                            <Ionicons name="checkmark" size={18} color={primaryColor} />
                          )}
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                  {errors.hostingGroup && (
                    <Text style={styles.fieldErrorText}>{errors.hostingGroup}</Text>
                  )}
                </>
              )}
            </View>
          )}

          {/* Series Toggle - shown when not editing */}
          {!isEditMode && (
            <View style={styles.fieldContainer}>
              <View style={styles.toggleRow}>
                <Text style={[styles.label, { color: colors.text }]}>Create / Add to Series</Text>
                <Switch
                  value={isSeriesMode}
                  onValueChange={(value) => {
                    setIsSeriesMode(value);
                    if (!value) {
                      setSelectedDates([]);
                      setTimeOfDay(null);
                      setSeriesName("");
                      setExistingSeriesName(null);
                    }
                    setErrors({});
                  }}
                  trackColor={{ false: colors.border, true: primaryColor }}
                  thumbColor={colors.textInverse}
                  disabled={isSubmitting}
                />
              </View>
              {isSeriesMode && (
                <Text style={[styles.helperText, { color: colors.textTertiary }]}>
                  Select multiple dates to create linked events
                </Text>
              )}
            </View>
          )}

          {/* Date & Time */}
          {isSeriesMode && !isEditMode ? (
            <>
              {/* Multi-date calendar picker */}
              <View style={styles.fieldContainer}>
                <Text style={[styles.label, { color: colors.text }]}>Dates *</Text>
                <MultiDateCalendarPicker
                  selectedDates={selectedDates}
                  onDatesChange={setSelectedDates}
                  minimumDate={isAdmin ? undefined : new Date()}
                  disabled={isSubmitting}
                />
                {errors.scheduledAt && (
                  <Text style={styles.fieldErrorText}>{errors.scheduledAt}</Text>
                )}
              </View>

              {/* Shared time picker */}
              <DatePicker
                label="Time"
                value={timeOfDay}
                onChange={setTimeOfDay}
                mode="time"
                placeholder="Select time for all dates"
                required
              />

              {/* Series Name */}
              <View style={styles.fieldContainer}>
                <Text style={[styles.label, { color: colors.text }]}>Series Name *</Text>
                {/* Existing series dropdown for community-wide */}
                {isCommunityWideEnabled && existingSeriesNames && existingSeriesNames.length > 0 && (
                  <View style={{ marginBottom: 8 }}>
                    <TouchableOpacity
                      style={[
                        styles.dropdownButton,
                        { borderColor: colors.inputBorder, backgroundColor: colors.inputBackground },
                      ]}
                      onPress={() => setIsSeriesNameDropdownOpen(!isSeriesNameDropdownOpen)}
                      disabled={isSubmitting}
                    >
                      <Text style={[
                        existingSeriesName ? styles.selectedGroupName : styles.dropdownPlaceholder,
                        { color: existingSeriesName ? colors.text : colors.inputPlaceholder },
                      ]}>
                        {existingSeriesName || "Add to existing series..."}
                      </Text>
                      <Ionicons
                        name={isSeriesNameDropdownOpen ? "chevron-up" : "chevron-down"}
                        size={20}
                        color={colors.textSecondary}
                      />
                    </TouchableOpacity>
                    {isSeriesNameDropdownOpen && (
                      <View style={[styles.dropdownList, { borderColor: colors.inputBorder, backgroundColor: colors.surface }]}>
                        <TouchableOpacity
                          style={[
                            styles.dropdownItem,
                            { borderBottomColor: colors.borderLight },
                            !existingSeriesName && [styles.dropdownItemSelected, { backgroundColor: colors.selectedBackground }],
                          ]}
                          onPress={() => {
                            setExistingSeriesName(null);
                            setSeriesName("");
                            setIsSeriesNameDropdownOpen(false);
                          }}
                        >
                          <Text style={[styles.dropdownItemText, { color: colors.text, fontStyle: "italic" }]}>
                            + Create new series
                          </Text>
                        </TouchableOpacity>
                        {existingSeriesNames.map((name) => (
                          <TouchableOpacity
                            key={name}
                            style={[
                              styles.dropdownItem,
                              { borderBottomColor: colors.borderLight },
                              existingSeriesName === name && [styles.dropdownItemSelected, { backgroundColor: colors.selectedBackground }],
                            ]}
                            onPress={() => {
                              setExistingSeriesName(name);
                              setSeriesName(name);
                              setIsSeriesNameDropdownOpen(false);
                            }}
                          >
                            <Text style={[
                              styles.dropdownItemText,
                              { color: colors.text },
                              existingSeriesName === name && [styles.dropdownItemTextSelected, { color: primaryColor }],
                            ]}>
                              {name}
                            </Text>
                            {existingSeriesName === name && (
                              <Ionicons name="checkmark" size={18} color={primaryColor} />
                            )}
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                )}
                {/* Series name text input (shown when creating new or for non-community-wide) */}
                {!existingSeriesName && (
                  <TextInput
                    style={[styles.input, { borderColor: colors.inputBorder, backgroundColor: colors.inputBackground, color: colors.text }]}
                    placeholder="e.g., Weekly Dinner Party"
                    placeholderTextColor={colors.inputPlaceholder}
                    value={seriesName}
                    onChangeText={setSeriesName}
                    editable={!isSubmitting}
                  />
                )}
                {(errors as any).seriesName && (
                  <Text style={styles.fieldErrorText}>{(errors as any).seriesName}</Text>
                )}
              </View>

              {/* Summary */}
              {selectedDates.length > 0 && (
                <View style={[styles.groupCountInfo, { backgroundColor: colors.surfaceSecondary }]}>
                  <Ionicons name="information-circle" size={16} color={colors.link} />
                  <Text style={[styles.groupCountText, { color: colors.link }]}>
                    {isCommunityWideEnabled && groupCountForType
                      ? `${selectedDates.length} dates \u00b7 ${groupCountForType} groups \u00b7 ${selectedDates.length * groupCountForType} events total`
                      : `${selectedDates.length} events will be created`}
                  </Text>
                </View>
              )}
            </>
          ) : (
            <DatePicker
              label="Date & Time"
              value={scheduledAt}
              onChange={setScheduledAt}
              mode="datetime"
              placeholder="Select date and time"
              error={errors.scheduledAt}
              required
            />
          )}

          {/* Title */}
          <View style={styles.fieldContainer}>
            <Text style={[styles.label, { color: colors.text }]}>Title</Text>
            <TextInput
              style={[styles.input, { borderColor: colors.inputBorder, backgroundColor: colors.inputBackground, color: colors.text }]}
              placeholder={`e.g., "${groupTypeName}" (leave blank for default)`}
              placeholderTextColor={colors.inputPlaceholder}
              value={title}
              onChangeText={setTitle}
              editable={!isSubmitting}
            />
            <Text style={[styles.helperText, { color: colors.textTertiary }]}>
              Leave blank to use "{groupTypeName}" as the title
            </Text>
          </View>

          {/* Cover Photo */}
          <View style={styles.fieldContainer}>
            <Text style={[styles.label, { color: colors.text }]}>Cover Photo</Text>
            <ImagePickerComponent
              currentImage={coverImage}
              onImageSelected={(uri) => {
                setCoverImage(uri);
              }}
              onImageRemoved={() => {
                setCoverImage(undefined);
              }}
              buttonText="Add Cover Photo"
              aspect={[16, 9]}
              isUploading={isUploadingImage}
            />
          </View>

          {/* Meeting Type Toggle */}
          <View style={styles.fieldContainer}>
            <View style={styles.toggleRow}>
              <Text style={[styles.label, { color: colors.text }]}>Online Event</Text>
              <Switch
                value={isOnline}
                onValueChange={setIsOnline}
                trackColor={{ false: colors.border, true: primaryColor }}
                thumbColor={colors.textInverse}
                disabled={isSubmitting}
              />
            </View>
          </View>

          {/* Meeting Link (only if online) */}
          {isOnline && (
            <View style={styles.fieldContainer}>
              <Text style={[styles.label, { color: colors.text }]}>Meeting Link</Text>
              <TextInput
                style={[styles.input, { borderColor: colors.inputBorder, backgroundColor: colors.inputBackground, color: colors.text }]}
                placeholder="https://zoom.us/j/..."
                placeholderTextColor={colors.inputPlaceholder}
                value={meetingLink}
                onChangeText={setMeetingLink}
                keyboardType="url"
                autoCapitalize="none"
                editable={!isSubmitting}
              />
            </View>
          )}

          {/* Location (only if in-person) */}
          {!isOnline && (
            <View style={styles.fieldContainer}>
              <Text style={[styles.label, { color: colors.text }]}>Location</Text>
              <TextInput
                style={[styles.input, { borderColor: colors.inputBorder, backgroundColor: colors.inputBackground, color: colors.text }]}
                placeholder="Enter full address with ZIP code"
                placeholderTextColor={colors.inputPlaceholder}
                value={location}
                onChangeText={setLocation}
                editable={!isSubmitting}
              />
              {/* Geocoding status indicator */}
              {location.trim() && !isOnline && (
                <>
                  {isCheckingLocation && (
                    <View style={styles.locationStatus}>
                      <ActivityIndicator size="small" color={primaryColor} />
                      <Text style={[styles.locationStatusText, { color: colors.textSecondary }]}>Checking location...</Text>
                    </View>
                  )}
                  {!isCheckingLocation && locationCanBeGeocoded === false && (
                    <View style={[styles.locationWarning, { backgroundColor: colors.surfaceSecondary }]}>
                      <Ionicons name="warning" size={20} color={colors.warning} />
                      <Text style={[styles.locationWarningText, { color: colors.textSecondary }]}>
                        This address couldn't be found. Enter a full address with ZIP code (e.g., "123 Main St, Dallas, TX 75201") so this event appears on the map.
                      </Text>
                    </View>
                  )}
                  {!isCheckingLocation && locationCanBeGeocoded === true && (
                    <View style={styles.locationSuccess}>
                      <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                      <Text style={[styles.locationSuccessText, { color: colors.success }]}>Location found</Text>
                    </View>
                  )}
                </>
              )}
            </View>
          )}

          {/* Notes */}
          <View style={styles.fieldContainer}>
            <Text style={[styles.label, { color: colors.text }]}>Notes</Text>
            <TextInput
              style={[styles.input, styles.textArea, { borderColor: colors.inputBorder, backgroundColor: colors.inputBackground, color: colors.text }]}
              placeholder="Add any notes about this event..."
              placeholderTextColor={colors.inputPlaceholder}
              value={note}
              onChangeText={setNote}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              editable={!isSubmitting}
            />
          </View>

          {/* RSVP Options */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>RSVP Options</Text>
            <View style={styles.toggleRow}>
              <Text style={[styles.toggleLabel, { color: colors.text }]}>Enable RSVPs</Text>
              <Switch value={rsvpEnabled} onValueChange={setRsvpEnabled} />
            </View>
            {rsvpEnabled && (
              <RsvpOptionsEditor
                options={rsvpOptions}
                onChange={setRsvpOptions}
              />
            )}
          </View>

          {/* Visibility */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Event Visibility</Text>
            <VisibilitySelector value={visibility} onChange={setVisibility} />
          </View>

          {/* Event Series - only in edit mode */}
          {isEditMode && meeting && (
            <View style={styles.fieldContainer}>
              <Text style={[styles.label, { color: colors.text }]}>Event Series</Text>
              {meeting.seriesInfo ? (
                // Currently in a series — show badge and remove option
                <View>
                  <SeriesBadge
                    seriesName={meeting.seriesInfo.seriesName}
                    seriesNumber={meeting.seriesInfo.seriesNumber}
                    seriesTotalCount={meeting.seriesInfo.seriesTotalCount}
                    size="medium"
                  />
                  <TouchableOpacity
                    style={[styles.removeSeriesButton, { borderColor: colors.destructive }]}
                    onPress={async () => {
                      Alert.alert(
                        "Remove from Series",
                        `Remove this event from "${meeting.seriesInfo!.seriesName}"? The event won't be deleted.`,
                        [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Remove",
                            style: "destructive",
                            onPress: async () => {
                              setIsSeriesLinking(true);
                              try {
                                await removeMeetingFromSeriesMutation({
                                  meetingId: meetingId as Id<"meetings">,
                                });
                              } catch (error: any) {
                                Alert.alert("Error", formatError(error, "Failed to remove from series"));
                              } finally {
                                setIsSeriesLinking(false);
                              }
                            },
                          },
                        ]
                      );
                    }}
                    disabled={isSeriesLinking}
                  >
                    <Text style={[styles.removeSeriesButtonText, { color: colors.destructive }]}>Remove from Series</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                // Not in a series — show options to add
                <View>
                  {isCreatingNewSeries ? (
                    <View style={{ gap: 8 }}>
                      <TextInput
                        style={[styles.input, { borderColor: colors.inputBorder, backgroundColor: colors.inputBackground, color: colors.text }]}
                        placeholder="Series name (e.g., Movie Night)"
                        placeholderTextColor={colors.inputPlaceholder}
                        value={newSeriesNameInput}
                        onChangeText={setNewSeriesNameInput}
                        autoFocus
                      />
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <TouchableOpacity
                          style={[styles.seriesActionButton, { borderColor: colors.border, flex: 1 }]}
                          onPress={() => { setIsCreatingNewSeries(false); setNewSeriesNameInput(""); }}
                        >
                          <Text style={[styles.seriesActionButtonText, { color: colors.textSecondary }]}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.seriesActionButton, { backgroundColor: primaryColor, borderColor: primaryColor, flex: 1, opacity: newSeriesNameInput.trim() ? 1 : 0.5 }]}
                          onPress={async () => {
                            if (!newSeriesNameInput.trim() || !meetingId || !editGroupId) return;
                            setIsSeriesLinking(true);
                            try {
                              await createSeriesFromMeetingsMutation({
                                groupId: editGroupId as Id<"groups">,
                                name: newSeriesNameInput.trim(),
                                meetingIds: [meetingId as Id<"meetings">],
                              });
                              setNewSeriesNameInput("");
                              setIsCreatingNewSeries(false);
                            } catch (error: any) {
                              Alert.alert("Error", formatError(error, "Failed to create series"));
                            } finally {
                              setIsSeriesLinking(false);
                            }
                          }}
                          disabled={!newSeriesNameInput.trim() || isSeriesLinking}
                        >
                          {isSeriesLinking ? (
                            <ActivityIndicator size="small" color={colors.textInverse} />
                          ) : (
                            <Text style={[styles.seriesActionButtonText, { color: colors.textInverse }]}>Create</Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <View style={{ gap: 8 }}>
                      {/* Existing series dropdown */}
                      {groupSeriesList && groupSeriesList.length > 0 && (
                        <>
                          <TouchableOpacity
                            style={[styles.dropdownButton, { borderColor: colors.inputBorder, backgroundColor: colors.inputBackground }]}
                            onPress={() => setIsSeriesDropdownOpen(!isSeriesDropdownOpen)}
                          >
                            <Text style={[styles.dropdownPlaceholder, { color: colors.inputPlaceholder }]}>Add to existing series...</Text>
                            <Ionicons name={isSeriesDropdownOpen ? "chevron-up" : "chevron-down"} size={20} color={colors.textSecondary} />
                          </TouchableOpacity>
                          {isSeriesDropdownOpen && (
                            <View style={[styles.dropdownList, { borderColor: colors.inputBorder, backgroundColor: colors.surface }]}>
                              {groupSeriesList.map((s) => (
                                <TouchableOpacity
                                  key={s._id}
                                  style={[styles.dropdownItem, { borderBottomColor: colors.borderLight }]}
                                  onPress={async () => {
                                    setIsSeriesDropdownOpen(false);
                                    setIsSeriesLinking(true);
                                    try {
                                      await addMeetingToSeriesMutation({
                                        meetingId: meetingId as Id<"meetings">,
                                        seriesId: s._id as Id<"eventSeries">,
                                      });
                                    } catch (error: any) {
                                      Alert.alert("Error", formatError(error, "Failed to add to series"));
                                    } finally {
                                      setIsSeriesLinking(false);
                                    }
                                  }}
                                >
                                  <Text style={[styles.dropdownItemText, { color: colors.text }]}>{s.name}</Text>
                                  <Text style={[styles.dropdownItemSubtext, { color: colors.textSecondary }]}>
                                    {s.meetingCount} event{s.meetingCount !== 1 ? "s" : ""}
                                  </Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                          )}
                        </>
                      )}
                      {/* Create new series button */}
                      <TouchableOpacity
                        style={[styles.seriesActionButton, { borderColor: colors.border }]}
                        onPress={() => setIsCreatingNewSeries(true)}
                      >
                        <Ionicons name="add" size={16} color={colors.text} />
                        <Text style={[styles.seriesActionButtonText, { color: colors.text }]}>New Series</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  <Text style={[styles.helperText, { color: colors.textTertiary }]}>
                    Link this event to a series to manage them together
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Submit Button */}
          <TouchableOpacity
            testID="submit-button"
            style={[
              styles.submitButton,
              { backgroundColor: primaryColor },
              isSubmitting && styles.submitButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <Text style={[styles.submitButtonText, { color: '#fff' }]}>
                {isEditMode ? "Save Changes" : "Create Event"}
              </Text>
            )}
          </TouchableOpacity>

          {/* Cancel Event Button - only show in edit mode */}
          {isEditMode && (
            <TouchableOpacity
              style={[
                styles.cancelEventButton,
                { backgroundColor: colors.surfaceSecondary, borderColor: colors.destructive },
                isSubmitting && styles.cancelEventButtonDisabled,
              ]}
              onPress={handleCancelEvent}
              disabled={isSubmitting}
            >
              <Ionicons name="close-circle-outline" size={20} color={colors.destructive} />
              <Text style={[styles.cancelEventButtonText, { color: colors.destructive }]}>Cancel Event</Text>
            </TouchableOpacity>
          )}
        </ScrollView>

        {/* Share to Chat Modal */}
        <ShareToChatModal
          visible={showShareModal}
          onClose={() => {
            setShowShareModal(false);
            setPendingMeetingId(null);
            router.back();
          }}
          onSend={handleSendToChat}
          onSkip={handleSkipShare}
          isLoading={postToChatMutation.isPending}
          eventTitle={title || groupTypeName}
        />

        {/* Past Date Confirmation Modal (for admins only) */}
        <ConfirmModal
          visible={showPastDateModal}
          title={isEditMode ? "Update to Past Date?" : "Create Past Event?"}
          message={isEditMode
            ? "You are changing this event's date to a time in the past. This will make it appear as a historical event. Are you sure you want to continue?"
            : "You are creating an event scheduled for a date in the past. This is typically used for recording historical events. Are you sure you want to continue?"
          }
          onConfirm={handleConfirmPastDate}
          onCancel={handleCancelPastDate}
          confirmText={isEditMode ? "Yes, Update Event" : "Yes, Create Event"}
          cancelText="Cancel"
        />
      </KeyboardAvoidingView>
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
    padding: 16,
    borderBottomWidth: 1,
  },
  backButton: {
    marginRight: 12,
    padding: 4,
  },
  headerContent: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 40,
  },
  fieldContainer: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
  },
  input: {
    borderWidth: 2,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
  },
  textArea: {
    minHeight: 150,
    paddingTop: 12,
  },
  helperText: {
    fontSize: 12,
    marginTop: 4,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 12,
  },
  toggleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
  },
  toggleLabel: {
    fontSize: 15,
  },
  toggleHint: {
    fontSize: 13,
    marginTop: 2,
  },
  submitButton: {
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 20,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  errorText: {
    fontSize: 18,
    marginBottom: 20,
  },
  backButtonError: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  backButtonErrorText: {
    fontSize: 16,
    fontWeight: "600",
  },
  // Hosting group dropdown styles
  loadingDropdown: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 8,
    gap: 12,
  },
  loadingDropdownText: {
    fontSize: 14,
  },
  noGroupsContainer: {
    padding: 16,
    backgroundColor: "#FEF2F2",
    borderRadius: 8,
  },
  noGroupsText: {
    fontSize: 14,
    color: "#991B1B",
  },
  dropdownButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 2,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  dropdownButtonError: {
    borderColor: "#DC2626",
  },
  dropdownPlaceholder: {
    fontSize: 16,
  },
  selectedGroupRow: {
    flex: 1,
  },
  selectedGroupName: {
    fontSize: 16,
    fontWeight: "500",
  },
  selectedGroupType: {
    fontSize: 12,
    marginTop: 2,
  },
  dropdownList: {
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 8,
    overflow: "hidden",
  },
  dropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  dropdownItemSelected: {
  },
  dropdownItemText: {
    flex: 1,
    fontSize: 15,
  },
  dropdownItemTextSelected: {
    fontWeight: "500",
  },
  dropdownItemSubtext: {
    fontSize: 12,
    marginRight: 8,
  },
  fieldErrorText: {
    fontSize: 12,
    color: "#DC2626",
    marginTop: 4,
  },
  cancelEventButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 16,
    paddingVertical: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#DC2626",
    backgroundColor: "#FEF2F2",
  },
  cancelEventButtonDisabled: {
    opacity: 0.6,
  },
  cancelEventButtonText: {
    color: "#DC2626",
    fontSize: 16,
    fontWeight: "600",
  },
  removeSeriesButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 10,
  },
  removeSeriesButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  seriesActionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
  },
  seriesActionButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  // Location geocoding status styles
  locationStatus: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    gap: 8,
  },
  locationStatusText: {
    fontSize: 13,
  },
  locationWarning: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#FEF3C7",
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    gap: 8,
  },
  locationWarningText: {
    flex: 1,
    fontSize: 13,
    color: "#92400E",
    lineHeight: 18,
  },
  locationSuccess: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    gap: 4,
  },
  locationSuccessText: {
    fontSize: 13,
    color: "#10B981",
  },
  // Community-wide event styles
  communityWideSection: {
    marginBottom: 20,
    backgroundColor: "#F5F3FF",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E0E7FF",
  },
  communityWideToggleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  communityWideToggleLabel: {
    flex: 1,
  },
  groupTypeSelector: {
    marginTop: 12,
  },
  groupCountInfo: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    padding: 12,
    backgroundColor: "#EEF2FF",
    borderRadius: 8,
    gap: 8,
  },
  groupCountText: {
    flex: 1,
    fontSize: 13,
    color: "#4338CA",
    lineHeight: 18,
  },
  // Community-wide event edit warning
  communityWideWarning: {
    backgroundColor: "#FEF3C7",
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#FCD34D",
  },
  communityWideWarningHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  communityWideWarningTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#92400E",
  },
  communityWideWarningText: {
    fontSize: 13,
    color: "#92400E",
    lineHeight: 18,
  },
});
