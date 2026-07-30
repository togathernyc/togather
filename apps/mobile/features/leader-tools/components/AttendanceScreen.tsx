import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { AttendanceDetails } from "./AttendanceDetails";
import { EventsList } from "./EventsList";
import { useQuery, api, Id } from "@services/api/convex";
import { DragHandle } from "@components/ui/DragHandle";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { waAccentPalette } from "@utils/waPalette";
import { WaSubScreenHeader } from "@components/wa/WaScreenHeader";
import { WA_GROUP_MARGIN } from "@components/wa/metrics";

/**
 * AttendanceScreen — pick an event, then read its attendance.
 *
 * Styled to `docs/plans/church-migration-ui-redesign/WHATSAPP-DESIGN-SYSTEM.md`
 * with the `components/wa/*` kit: a floating `WaSubScreenHeader` instead of an
 * opaque nav bar (S1.1 — the old bar plus its safe-area padding ate the top
 * third of the screen), a `backgroundGrouped` canvas, and the event picker /
 * report rendered as inset-grouped cards. Unlike the flag-gated shell screens
 * this one is styled unconditionally: it's a leaf screen reachable from both
 * shells (group info and the chat menu), and the kit is theme-driven, so a
 * second flag-off layout would only be duplicate code to maintain.
 */
export function AttendanceScreen() {
  const { colors, isDark } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const waAccent = waAccentPalette(primaryColor, isDark).accent;
  // NOTE: group_id is expected to be a Convex Id<"groups"> passed from navigation.
  // The leader-tools routes should only receive Convex IDs, not legacy UUIDs.
  const { group_id, eventDate: queryEventDate } = useLocalSearchParams<{
    group_id: string;
    eventDate?: string;
  }>();
  const router = useRouter();
  // Fetch group details (minimal - just for validation)
  const group = useQuery(
    api.functions.groups.index.getById,
    group_id ? { groupId: group_id as Id<"groups"> } : "skip"
  );
  const isLoadingGroup = group === undefined;
  const groupError = group === null;

  // Track selected event - only fetch attendance when an event is selected
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(
    null
  );
  const [selectedEventDate, setSelectedEventDate] = useState<string | null>(
    queryEventDate || null
  );

  // The attendance report itself is fetched by <AttendanceDetails /> below —
  // this screen only picks the event, so it subscribes to nothing extra.

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      // Fallback to group page if can't go back
      router.push(`/(user)/leader-tools/${group_id}`);
    }
  };

  const handleEdit = () => {
    if (!selectedEventDate) return;

    // Prevent editing attendance for future events
    const isFutureEvent = new Date(selectedEventDate) > new Date();
    if (isFutureEvent) {
      // Don't navigate to edit page for future events
      return;
    }
    // Leaders can always edit attendance, even after it's been submitted
    // Navigate to edit page with current date AND meetingId as query parameters
    // FIX for Issue #303: Include meetingId to ensure attendance is recorded
    // for the correct event when multiple events exist on the same day
    const encodedDate = encodeURIComponent(selectedEventDate);
    const meetingIdParam = selectedMeetingId
      ? `&meetingId=${encodeURIComponent(selectedMeetingId)}`
      : "";
    router.push(
      `/(user)/leader-tools/${group_id}/attendance/edit?eventDate=${encodedDate}${meetingIdParam}`
    );
  };

  if (isLoadingGroup) {
    return (
      <>
        <View style={[styles.container, { backgroundColor: colors.backgroundGrouped }]}>
          <DragHandle />
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading...</Text>
          </View>
        </View>
      </>
    );
  }

  if (groupError || !group) {
    return (
      <>
        <View style={[styles.container, { backgroundColor: colors.backgroundGrouped }]}>
          <DragHandle />
          <View style={styles.errorContainer}>
            <Text style={[styles.errorText, { color: colors.textSecondary }]}>Group not found</Text>
            <TouchableOpacity
              style={[styles.errorBackButton, { backgroundColor: colors.border }]}
              onPress={() => {
                if (router.canGoBack()) {
                  router.back();
                } else {
                  router.push(`/(user)/leader-tools/${group_id}`);
                }
              }}
            >
              <Text style={[styles.errorText, { color: colors.textSecondary }]}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </>
    );
  }

  // Always show attendance details, even if no past event exists
  // Users can select any date to take attendance or modify RSVPs
  return (
    <>
      <View style={[styles.container, { backgroundColor: colors.backgroundGrouped }]}>
        <DragHandle />
        {/* S1.1: floating circular back button + centered 17pt title, no bar
            fill and no hairline. No safe-area padding here — this screen is
            presented as a sheet whose drag handle already clears the status
            bar, and adding `insets.top` on top of it is what left a ~200pt
            band of empty chrome above the title (same as the check-in sheet). */}
        <WaSubScreenHeader
          title="Attendance"
          onBack={handleBack}
          accent={waAccent}
          style={styles.header}
        />

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
        >
          <EventsList
            groupId={group_id || ""}
            selectedDate={selectedEventDate}
            onEventSelect={(meetingId, date) => {
              setSelectedMeetingId(meetingId || null);
              setSelectedEventDate(date || null);
            }}
          />

          {selectedMeetingId || selectedEventDate ? (
            <AttendanceDetails
              groupId={group_id || ""}
              eventDate={selectedEventDate || new Date().toISOString()}
              meetingId={selectedMeetingId || undefined}
              onBack={handleBack}
              onEdit={handleEdit}
              onCancelEdit={() => {}} // Not in edit mode, so no cancel needed
              editMode={false}
              onUpdateAttendance={() => {}} // Not in edit mode
              onUpdateNote={() => {}} // Not in edit mode
              attendance={[]} // Not in edit mode
              note={""} // Not in edit mode
            />
          ) : (
            // Sits right under the picker rather than centered in the void —
            // the prompt belongs next to the thing it's prompting about.
            <View style={styles.emptyState}>
              <Ionicons
                name="calendar-outline"
                size={28}
                color={colors.textTertiary}
              />
              <Text style={[styles.emptyStateText, { color: colors.textSecondary }]}>
                Select an event to view attendance
              </Text>
            </View>
          )}
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
    paddingTop: 4,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 8,
    paddingBottom: 32,
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
    fontSize: 18,
    marginBottom: 20,
  },
  errorBackButton: {
    padding: 12,
    borderRadius: 8,
  },
  emptyState: {
    alignItems: "center",
    gap: 8,
    paddingHorizontal: WA_GROUP_MARGIN,
    paddingTop: 24,
  },
  emptyStateText: {
    fontSize: 15,
    textAlign: "center",
  },
});
