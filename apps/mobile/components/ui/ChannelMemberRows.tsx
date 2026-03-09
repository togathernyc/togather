/**
 * Shared components for rendering channel members and unsynced PCO people.
 *
 * These components extract the duplicated rendering logic from:
 * - features/leader-tools/components/Members.tsx
 * - app/inbox/[groupId]/[channelSlug]/members.tsx
 * - features/channels/components/ChannelMembersModal.tsx
 */
import React, { ReactNode } from "react";
import { View, Text, StyleSheet, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ChannelMember, UnsyncedPerson } from "@/utils/channel-members";
import { getDebugReasonText } from "@/utils/channel-members";

/**
 * Calculate initials from a display name.
 * Returns first letter of first and last names, uppercase, max 2 chars.
 */
export function getInitials(displayName: string): string {
  return (
    displayName
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "?"
  );
}

interface SyncedMemberRowContentProps {
  member: ChannelMember;
  primaryColor: string;
  isCurrentUser?: boolean;
  /** Optional content to render at the end of the row (e.g., remove button, chevron) */
  rightContent?: ReactNode;
}

/**
 * Renders the content of a synced member row: avatar, name, badges, and sync metadata.
 * Does NOT include TouchableOpacity wrapper - parent components handle that.
 */
export function SyncedMemberRowContent({
  member,
  primaryColor,
  isCurrentUser = false,
  rightContent,
}: SyncedMemberRowContentProps) {
  const isOwner = member.role === "owner";
  const isAdmin = member.role === "admin";
  const isPcoSynced = member.syncSource === "pco_services";
  const initials = getInitials(member.displayName);

  return (
    <>
      {/* Avatar */}
      <View style={styles.memberAvatar}>
        {member.profilePhoto ? (
          <Image source={{ uri: member.profilePhoto }} style={styles.avatarImage} />
        ) : (
          <View style={[styles.avatarPlaceholder, { backgroundColor: primaryColor }]}>
            <Text style={styles.avatarInitials}>{initials}</Text>
          </View>
        )}
      </View>

      {/* Name and badges */}
      <View style={styles.memberInfo}>
        <View style={styles.memberNameRow}>
          <Text style={styles.memberName} numberOfLines={1}>
            {member.displayName}
          </Text>
          {isCurrentUser && <Text style={styles.youBadge}>(you)</Text>}
        </View>

        {/* Role badges */}
        {isOwner && (
          <View style={[styles.roleBadge, { backgroundColor: `${primaryColor}20` }]}>
            <Text style={[styles.roleBadgeText, { color: primaryColor }]}>Owner</Text>
          </View>
        )}
        {isAdmin && !isOwner && (
          <View style={[styles.roleBadge, { backgroundColor: `${primaryColor}20` }]}>
            <Text style={[styles.roleBadgeText, { color: primaryColor }]}>Admin</Text>
          </View>
        )}

        {/* PCO sync metadata - team and position */}
        {isPcoSynced && member.syncMetadata && (
          <View style={styles.syncMetadataRow}>
            {member.syncMetadata.teamName && (
              <View style={styles.syncBadge}>
                <Ionicons name="people" size={10} color="#2196F3" />
                <Text style={styles.syncBadgeText}>
                  {member.syncMetadata.serviceTypeName
                    ? `${member.syncMetadata.serviceTypeName} > ${member.syncMetadata.teamName}`
                    : member.syncMetadata.teamName}
                </Text>
              </View>
            )}
            {member.syncMetadata.position && (
              <View style={[styles.syncBadge, styles.positionBadge]}>
                <Ionicons name="musical-notes" size={10} color="#FF9800" />
                <Text style={[styles.syncBadgeText, styles.positionBadgeText]}>
                  {member.syncMetadata.position}
                </Text>
              </View>
            )}
          </View>
        )}
      </View>

      {rightContent}
    </>
  );
}

interface UnsyncedPersonRowContentProps {
  person: UnsyncedPerson;
}

/**
 * Renders the content of an unsynced PCO person row: avatar with warning, name, badges, and reason.
 */
export function UnsyncedPersonRowContent({
  person,
}: UnsyncedPersonRowContentProps) {
  const initials = getInitials(person.pcoName);

  return (
    <>
      {/* Avatar with warning indicator */}
      <View style={styles.memberAvatar}>
        <View style={[styles.avatarPlaceholder, styles.unsyncedAvatarPlaceholder]}>
          <Text style={[styles.avatarInitials, styles.unsyncedAvatarInitials]}>
            {initials}
          </Text>
        </View>
      </View>

      {/* Name and badges */}
      <View style={styles.memberInfo}>
        <View style={styles.memberNameRow}>
          <Text style={styles.memberName} numberOfLines={1}>
            {person.pcoName}
          </Text>
          <Ionicons name="warning" size={14} color="#B25000" style={{ marginLeft: 4 }} />
        </View>

        {/* Team and position chips */}
        {(person.teamName || person.position) && (
          <View style={styles.syncMetadataRow}>
            {person.teamName && (
              <View style={styles.syncBadge}>
                <Ionicons name="people" size={10} color="#2196F3" />
                <Text style={styles.syncBadgeText}>
                  {person.serviceTypeName
                    ? `${person.serviceTypeName} > ${person.teamName}`
                    : person.teamName}
                </Text>
              </View>
            )}
            {person.position && (
              <View style={[styles.syncBadge, styles.positionBadge]}>
                <Ionicons name="musical-notes" size={10} color="#FF9800" />
                <Text style={[styles.syncBadgeText, styles.positionBadgeText]}>
                  {person.position}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Reason text */}
        <Text style={styles.unsyncedReasonText}>
          {getDebugReasonText(person.reason, person)}
        </Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  memberAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: "hidden",
    marginRight: 12,
  },
  avatarImage: {
    width: "100%",
    height: "100%",
  },
  avatarPlaceholder: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarInitials: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
  },
  unsyncedAvatarPlaceholder: {
    backgroundColor: "#FFB74D",
  },
  unsyncedAvatarInitials: {
    color: "#fff",
  },
  memberInfo: {
    flex: 1,
  },
  memberNameRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 2,
  },
  memberName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    flexShrink: 1,
  },
  youBadge: {
    fontSize: 13,
    color: "#888",
    marginLeft: 4,
  },
  roleBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    marginTop: 2,
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  syncMetadataRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 4,
  },
  syncBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E3F2FD",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    gap: 3,
  },
  syncBadgeText: {
    fontSize: 11,
    color: "#2196F3",
    fontWeight: "500",
  },
  positionBadge: {
    backgroundColor: "#FF980020",
  },
  positionBadgeText: {
    color: "#FF9800",
  },
  unsyncedReasonText: {
    fontSize: 12,
    color: "#B25000",
    marginTop: 4,
    fontStyle: "italic",
  },
});
