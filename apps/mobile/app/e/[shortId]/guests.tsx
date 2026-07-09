import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, api } from "@services/api/convex";
import { useAuth } from "@/providers/AuthProvider";
import { Avatar } from "@components/ui/Avatar";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { SafeBlurView } from "@components/ui/SafeBlurView";
import {
  getEmojiForOption,
  getCleanLabel,
} from "@/features/events/components/EventRsvpSection";

/**
 * Guest List Page - /e/[shortId]/guests
 *
 * Shows full list of event attendees grouped by RSVP status.
 * Access is restricted to users who have RSVP'd to the event.
 */
export default function GuestListScreen() {
  const { shortId } = useLocalSearchParams<{ shortId: string }>();
  const router = useRouter();
  const { isAuthenticated, token } = useAuth();

  // Fetch event by short ID using Convex
  const event = useQuery(
    api.functions.meetings.index.getByShortId,
    shortId ? { shortId, token: token ?? undefined } : "skip"
  );
  const isLoadingEvent = event === undefined;

  // Fetch my RSVP using Convex
  const myRsvp = useQuery(
    api.functions.meetingRsvps.myRsvp,
    event?.id && isAuthenticated && event?.hasAccess && token
      ? { meetingId: event.id, token }
      : "skip"
  );
  const isLoadingMyRsvp = myRsvp === undefined && event?.id && isAuthenticated && event?.hasAccess;

  // Fetch RSVP list using Convex
  // Pass token if available to get full access (if user has RSVPed)
  const rsvpData = useQuery(
    api.functions.meetingRsvps.list,
    event?.id && event?.hasAccess
      ? { meetingId: event.id, token: token ?? undefined }
      : "skip"
  );
  const isLoadingRsvp = rsvpData === undefined && event?.id && event?.hasAccess;

  // Only access rsvpOptions when event has access (full data available)
  const rsvpOptions = (event?.hasAccess && event?.rsvpOptions ? event.rsvpOptions : []) as any[];
  const hasRsvpd = !!myRsvp?.optionId;

  // The backend grants the full guest list to users who have RSVP'd AND to
  // event leaders/hosts/community admins (see meetingRsvps.list). It signals a
  // gated response with `limitedAccess`, so drive the restricted overlay off
  // that instead of the viewer's own RSVP — otherwise a leader who hasn't
  // RSVP'd would be blocked from a list the backend already returned. Fall back
  // to the user's own RSVP state while the list query is still loading.
  const hasFullAccess = rsvpData ? !rsvpData.limitedAccess : hasRsvpd;

  // Full access granted by a leader/host/admin role rather than the viewer's own
  // RSVP. Used to remind them the list is hidden from members who haven't RSVP'd.
  const canManage = !!rsvpData?.canManage;

  const isLoading = isLoadingEvent || isLoadingMyRsvp || isLoadingRsvp;

  if (isLoading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color={DEFAULT_PRIMARY_COLOR} />
      </SafeAreaView>
    );
  }

  if (!event) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.errorText}>Event not found</Text>
        <TouchableOpacity
          style={styles.backButtonError}
          onPress={() => router.back()}
        >
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const handleRsvp = () => {
    // Navigate back to event page to RSVP
    router.back();
  };

  // Calculate total guests across all RSVP options
  const totalGuests = rsvpData?.total ?? 0;

  // Render guest list content (used in both states)
  const renderGuestList = () => (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      scrollEnabled={hasFullAccess}
    >
      {rsvpData?.rsvps.map((rsvpGroup) => {
        if (rsvpGroup.count === 0) return null;

        const option = rsvpOptions.find(
          (opt) => opt.id === rsvpGroup.option.id
        );
        const emoji = option ? getEmojiForOption(option) : "";
        const label = option ? getCleanLabel(option.label) : rsvpGroup.option.label;

        return (
          <View key={rsvpGroup.option.id} style={styles.rsvpGroup}>
            <View style={styles.groupHeader}>
              <Text style={styles.groupEmoji}>{emoji}</Text>
              <Text style={styles.groupLabel}>{label}</Text>
              <Text style={styles.groupCount}>{rsvpGroup.count}</Text>
            </View>
            <View style={styles.guestList}>
              {rsvpGroup.users.map((user) => {
                const guestCount = (user as { guestCount?: number }).guestCount ?? 0;
                return (
                  <View key={user.id} style={styles.guestRow}>
                    <Avatar
                      name={`${user.firstName} ${user.lastName}`}
                      imageUrl={user.profileImage || undefined}
                      size={44}
                    />
                    <View style={styles.guestInfo}>
                      <Text style={styles.guestName}>
                        {user.firstName} {user.lastName}
                      </Text>
                      {guestCount > 0 && (
                        <Text style={styles.guestSubtitle}>
                          +{guestCount} guest{guestCount === 1 ? "" : "s"}
                        </Text>
                      )}
                    </View>
                    {guestCount > 0 && (
                      <View style={styles.guestBadge}>
                        <Text style={styles.guestBadgeText}>+{guestCount}</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        );
      })}

      {totalGuests === 0 && (
        <View style={styles.emptyState}>
          <Ionicons name="people-outline" size={48} color="#ccc" />
          <Text style={styles.emptyText}>No RSVPs yet</Text>
          <Text style={styles.emptySubtext}>
            Be the first to RSVP to this event!
          </Text>
        </View>
      )}
    </ScrollView>
  );

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons name="chevron-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Guest List</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Leader notice — this list is restricted to RSVP'd members for others */}
      {canManage && (
        <View style={styles.leaderNotice}>
          <Ionicons name="eye-outline" size={16} color="#8a6d1f" />
          <Text style={styles.leaderNoticeText}>
            You can see this as a leader. Members who haven't RSVP'd only see a
            preview until they RSVP.
          </Text>
        </View>
      )}

      {/* Content Area */}
      <View style={styles.contentWrapper}>
        {/* Guest List */}
        {renderGuestList()}

        {/* Restricted Access Overlay - covers full content area */}
        {!hasFullAccess && (
          <SafeBlurView
            intensity={50}
            tint="dark"
            style={styles.blurOverlay}
          >
            <View style={styles.restrictedCard}>
              <View style={styles.lockIconContainer}>
                <Ionicons name="lock-closed" size={32} color="#fff" />
              </View>
              <Text style={styles.restrictedTitle}>Restricted Access</Text>
              <Text style={styles.restrictedMessage}>
                Only RSVP'd guests can view event activity & see who's going
              </Text>

              <TouchableOpacity
                style={styles.rsvpButton}
                onPress={handleRsvp}
              >
                <Text style={styles.rsvpButtonText}>RSVP</Text>
              </TouchableOpacity>

              <View style={styles.tipContainer}>
                <Ionicons name="information-circle" size={16} color="#888" />
                <Text style={styles.tipText}>
                  Not sure if you'll go? Pick "Maybe"
                </Text>
              </View>
            </View>
          </SafeBlurView>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  errorText: {
    fontSize: 16,
    color: "#666",
    marginTop: 12,
  },
  backButtonError: {
    marginTop: 20,
    padding: 12,
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    borderRadius: 8,
  },
  backButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
    zIndex: 10,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    textAlign: "center",
  },
  headerSpacer: {
    width: 32,
  },

  // Leader notice
  leaderNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#fdf6e3",
    borderBottomWidth: 1,
    borderBottomColor: "#f0e6c8",
  },
  leaderNoticeText: {
    flex: 1,
    fontSize: 13,
    color: "#8a6d1f",
    lineHeight: 18,
  },

  // Content
  contentWrapper: {
    flex: 1,
    position: "relative",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 100,
  },

  // RSVP Groups
  rsvpGroup: {
    marginBottom: 24,
  },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    gap: 8,
  },
  groupEmoji: {
    fontSize: 20,
  },
  groupLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    flex: 1,
  },
  groupCount: {
    fontSize: 14,
    color: "#666",
    backgroundColor: "#f0f0f0",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },

  // Guest List
  guestList: {
    gap: 8,
  },
  guestRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    backgroundColor: "#f8f8f8",
    borderRadius: 12,
    gap: 12,
  },
  guestInfo: {
    flex: 1,
  },
  guestName: {
    fontSize: 15,
    fontWeight: "500",
    color: "#333",
  },
  guestSubtitle: {
    fontSize: 12,
    color: "#666",
    marginTop: 2,
  },
  guestBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: DEFAULT_PRIMARY_COLOR,
  },
  guestBadgeText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },

  // Empty State
  emptyState: {
    alignItems: "center",
    paddingVertical: 48,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: "#666",
    marginTop: 8,
  },

  // Blur Overlay - covers full content area
  blurOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  restrictedCard: {
    backgroundColor: "rgba(30, 30, 30, 0.95)",
    borderRadius: 20,
    padding: 28,
    alignItems: "center",
    width: "100%",
    maxWidth: 320,
  },
  lockIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  restrictedTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#fff",
    marginBottom: 12,
    textAlign: "center",
  },
  restrictedMessage: {
    fontSize: 15,
    color: "#aaa",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },
  rsvpButton: {
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 48,
    width: "100%",
    alignItems: "center",
    marginBottom: 20,
  },
  rsvpButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#000",
  },
  tipContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  tipText: {
    fontSize: 13,
    color: "#888",
  },
});
