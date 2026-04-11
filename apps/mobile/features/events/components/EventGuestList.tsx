import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Avatar } from "@components/ui/Avatar";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { useTheme } from "@hooks/useTheme";
import { isGoingOptionLabel } from "./EventRsvpSection";

// ============================================================================
// Types
// ============================================================================

export interface RsvpUser {
  id: string;
  firstName: string;
  lastName: string;
  profileImage: string | null;
  guestCount?: number;
}

export interface RsvpOptionResponse {
  option: { id: number; label: string };
  count: number;
  guestCount?: number;
  users: RsvpUser[];
}

export interface RsvpData {
  rsvps: RsvpOptionResponse[];
  total: number;
  totalWithGuests?: number;
}

export interface RsvpOption {
  id: number;
  label: string;
  enabled: boolean;
}

interface GuestListPreviewProps {
  rsvpData: RsvpData;
  rsvpOptions: RsvpOption[];
  onViewAll: () => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Guest List Preview - Shows avatar stack of attendees
 * Displays up to 6 avatars with overflow count
 */
export function GuestListPreview({
  rsvpData,
  rsvpOptions,
  onViewAll,
}: GuestListPreviewProps) {
  const { colors } = useTheme();
  // Find the "Going" option to show those guests. Uses the same heuristic
  // as isGoingOption in apps/convex/lib/rsvpGuests.ts so decline variants
  // ("Not Going") aren't mistakenly treated as Going.
  const goingOption = rsvpOptions.find((opt) => isGoingOptionLabel(opt.label));
  const goingRsvp = rsvpData.rsvps.find((r) => r.option.id === goingOption?.id);
  const goingCount = goingRsvp?.count || 0;
  const goingGuestCount = goingRsvp?.guestCount || 0;
  const goingUsers = goingRsvp?.users || [];

  // Find the "Maybe" option to also show those guests
  const maybeOption = rsvpOptions.find((opt) =>
    opt.label.toLowerCase().includes("maybe")
  );
  const maybeRsvp = rsvpData.rsvps.find((r) => r.option.id === maybeOption?.id);
  const maybeCount = maybeRsvp?.count || 0;
  const maybeUsers = maybeRsvp?.users || [];

  // Combine users: Going first, then Maybe
  const allUsers = [...goingUsers, ...maybeUsers];
  const totalCount = goingCount + maybeCount;

  // Show top 6 avatars
  const displayUsers = allUsers.slice(0, 6);
  const overflowCount = totalCount > 6 ? totalCount - 6 : 0;

  // Build subtitle text. Plus-ones (guestCount) only apply to Going.
  const subtitleParts: string[] = [];
  if (goingCount > 0) {
    const goingLabel =
      goingGuestCount > 0
        ? `${goingCount} Going (+${goingGuestCount} guest${goingGuestCount === 1 ? "" : "s"})`
        : `${goingCount} Going`;
    subtitleParts.push(goingLabel);
  }
  if (maybeCount > 0) subtitleParts.push(`${maybeCount} Maybe`);
  const subtitleText = subtitleParts.join(", ");

  if (totalCount === 0) {
    return null;
  }

  return (
    <View style={[styles.container, { borderTopColor: colors.border }]}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.title, { color: colors.text }]}>Guest List</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitleText}</Text>
        </View>
        <TouchableOpacity style={[styles.viewAllButton, { backgroundColor: colors.surfaceSecondary }]} onPress={onViewAll}>
          <Text style={[styles.viewAllText, { color: colors.text }]}>View all</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.avatarStack}>
        {displayUsers.map((user, index) => (
          <View
            key={user.id}
            style={[
              styles.avatarWrapper,
              { marginLeft: index === 0 ? 0 : -8 },
              { zIndex: displayUsers.length - index },
            ]}
          >
            <Avatar
              name={`${user.firstName} ${user.lastName}`}
              imageUrl={user.profileImage || undefined}
              size={36}
              style={styles.avatar}
            />
          </View>
        ))}
        {overflowCount > 0 && (
          <View style={[styles.avatarWrapper, { marginLeft: -8 }]}>
            <View style={styles.overflowBadge}>
              <Text style={styles.overflowText}>+{overflowCount}</Text>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    marginTop: 24,
    paddingTop: 24,
    borderTopWidth: 1,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
  },
  viewAllButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  viewAllText: {
    fontSize: 14,
    fontWeight: "500",
  },
  avatarStack: {
    flexDirection: "row",
    alignItems: "center",
  },
  avatarWrapper: {
    borderWidth: 2,
    borderColor: "#fff",
    borderRadius: 20,
  },
  avatar: {
    borderRadius: 18,
  },
  overflowBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    justifyContent: "center",
    alignItems: "center",
  },
  overflowText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
});
