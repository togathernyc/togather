import React, { useState, useMemo, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  Image,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { UserRoute } from "@components/guards/UserRoute";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, usePaginatedQuery, api } from "@services/api/convex";
import { Id } from "@services/api/convex";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { DragHandle } from "@components/ui/DragHandle";
import { useIsDesktopWeb } from "@hooks/useIsDesktopWeb";
import { FollowupDesktopTable } from "./FollowupDesktopTable";

type SortDirection = "asc" | "desc";

type ScoreConfigEntry = {
  id: string;
  name: string;
};

type FollowupMember = {
  _id: string;
  groupMemberId: string;
  userId: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  score1: number;
  score2: number;
  score3?: number;
  score4?: number;
  scoreIds: string[];
  alerts: string[];
  isSnoozed: boolean;
  snoozedUntil?: number;
  attendanceScore: number;
  connectionScore: number;
  followupScore: number;
  missedMeetings: number;
  consecutiveMissed: number;
  lastAttendedAt?: number;
  lastFollowupAt?: number;
  scoreFactors?: {
    recencyWeight: number;
    streakPenalty: number;
    dropoffDetected: boolean;
    activeInOtherGroups: boolean;
    otherGroupMeetingsAttended: number;
  };
};

// Subtitle variable options for member cards (pick up to 2)
type SubtitleVariable = {
  id: string;
  label: string;
  render: (item: FollowupMember, formatDate: (d: number | undefined) => string) => string;
};

export const SUBTITLE_VARIABLES: SubtitleVariable[] = [
  {
    id: "missed_count",
    label: "Missed count",
    render: (item) => `${item.missedMeetings} missed`,
  },
  {
    id: "consecutive_missed",
    label: "Consecutive missed",
    render: (item) => `${item.consecutiveMissed} missed in a row`,
  },
  {
    id: "last_attended",
    label: "Last attended",
    render: (item, formatDate) => `Last: ${formatDate(item.lastAttendedAt)}`,
  },
  {
    id: "last_followup",
    label: "Last follow-up",
    render: (item, formatDate) => `Follow-up: ${formatDate(item.lastFollowupAt)}`,
  },
];

export const SUBTITLE_VARIABLE_MAP = new Map(
  SUBTITLE_VARIABLES.map((v) => [v.id, v])
);

/**
 * Get the score value for a given score config entry from a member doc.
 * Maps scoreConfig[i].id → score1, score2, score3, score4.
 */
function getScoreValue(member: FollowupMember, scoreId: string): number {
  const idx = member.scoreIds.indexOf(scoreId);
  if (idx === 0) return member.score1;
  if (idx === 1) return member.score2;
  if (idx === 2) return member.score3 ?? 0;
  if (idx === 3) return member.score4 ?? 0;
  return 0;
}

export function FollowupScreen() {
  const { group_id } = useLocalSearchParams<{ group_id: string }>();
  const isDesktop = useIsDesktopWeb();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { primaryColor } = useCommunityTheme();

  // Sort state — maps to server-side index
  // "score1" and "score2" use server indexes; "__weighted__" uses client-side
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Config query (called once, not per-page)
  const config = useQuery(
    api.functions.memberFollowups.getFollowupConfig,
    group_id ? { groupId: group_id as Id<"groups"> } : "skip"
  );

  const scoreConfig: ScoreConfigEntry[] = config?.scoreConfigScores ?? [];
  const toolDisplayName = config?.toolDisplayName ?? "Follow-up";
  const memberSubtitle = config?.memberSubtitle ?? "";

  // Initialize sortField from the first score in config once available
  useEffect(() => {
    if (sortField === null && scoreConfig.length > 0) {
      setSortField(scoreConfig[0].id);
    }
  }, [scoreConfig, sortField]);

  // Map sortField to server sort key
  const serverSortBy = useMemo(() => {
    if (!sortField || sortField === "__weighted__") return "score1";
    const idx = scoreConfig.findIndex((s) => s.id === sortField);
    if (idx === 0) return "score1";
    if (idx === 1) return "score2";
    return "score1";
  }, [sortField, scoreConfig]);

  // For weighted sort, we use score1 index and re-sort client-side
  const serverSortDirection = sortField === "__weighted__" ? "desc" : sortDirection;

  // Paginated member list from pre-computed scores
  const {
    results: rawMembers,
    status: paginationStatus,
    loadMore,
    isLoading,
  } = usePaginatedQuery(
    api.functions.memberFollowups.list,
    group_id
      ? {
          groupId: group_id as Id<"groups">,
          sortBy: serverSortBy,
          sortDirection: serverSortDirection,
        }
      : "skip",
    { initialNumItems: 50 }
  );

  // Apply client-side weighted sort if needed
  const members = useMemo(() => {
    if (!rawMembers) return undefined;

    if (sortField !== "__weighted__") {
      return rawMembers as unknown as FollowupMember[];
    }

    // Weighted sort: alert count (desc) then average score
    const sorted = [...rawMembers] as unknown as FollowupMember[];
    sorted.sort((a, b) => {
      const aAlerts = a.alerts?.length ?? 0;
      const bAlerts = b.alerts?.length ?? 0;
      if (aAlerts !== bAlerts) {
        return sortDirection === "desc" ? bAlerts - aAlerts : aAlerts - bAlerts;
      }
      // Tiebreaker: average of all configured scores
      const aAvg = scoreConfig.length > 0
        ? scoreConfig.reduce((sum, sc) => sum + getScoreValue(a, sc.id), 0) / scoreConfig.length
        : 0;
      const bAvg = scoreConfig.length > 0
        ? scoreConfig.reduce((sum, sc) => sum + getScoreValue(b, sc.id), 0) / scoreConfig.length
        : 0;
      return sortDirection === "desc" ? aAvg - bAvg : bAvg - aAvg;
    });
    return sorted;
  }, [rawMembers, sortField, sortDirection, scoreConfig]);

  // Fetch group info for header
  const groupData = useQuery(
    api.functions.groups.index.getById,
    group_id ? { groupId: group_id as Id<"groups"> } : "skip"
  );

  const group = useMemo(() => {
    if (!groupData) return undefined;
    return { name: groupData.name };
  }, [groupData]);

  // Desktop: render spreadsheet table with side sheet
  if (isDesktop) {
    return (
      <UserRoute>
        <FollowupDesktopTable groupId={group_id || ""} />
      </UserRoute>
    );
  }

  // Handle sort option press
  const handleSortPress = (field: string) => {
    if (field === sortField) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection(field === "__weighted__" ? "desc" : "asc");
    }
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.push("/(tabs)/chat");
    }
  };

  const handleMemberPress = (memberId: string) => {
    router.push(`/(user)/leader-tools/${group_id}/followup/${memberId}`);
  };

  const handleSettingsPress = () => {
    router.push(`/(user)/leader-tools/${group_id}/tool-settings/followup`);
  };

  const formatDate = (timestamp: number | undefined) => {
    if (!timestamp) return "Never";
    const date = new Date(timestamp);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const getMemberSubtitleLines = (item: FollowupMember): string[] => {
    if (!memberSubtitle) {
      return [
        `${item.missedMeetings} missed`,
        `Last: ${formatDate(item.lastAttendedAt)}`,
      ];
    }
    const varIds = memberSubtitle.split(",").filter(Boolean);
    if (varIds.length === 0) return [];
    return varIds
      .map((id: string) => SUBTITLE_VARIABLE_MAP.get(id))
      .filter((v: SubtitleVariable | undefined): v is SubtitleVariable => v !== undefined)
      .map((v: SubtitleVariable) => v.render(item, formatDate));
  };

  const getScoreStyle = (value: number) => {
    if (value >= 70) return { circle: styles.scoreCircleGood, text: styles.scoreGood };
    if (value >= 40) return { circle: styles.scoreCircleWarning, text: styles.scoreWarning };
    return { circle: styles.scoreCircleLow, text: styles.scoreLow };
  };

  const renderMember = ({ item }: { item: FollowupMember }) => {
    const isSnoozed = item.isSnoozed && !!item.snoozedUntil && item.snoozedUntil > Date.now();
    const hasAlerts = (item.alerts?.length ?? 0) > 0;

    return (
      <TouchableOpacity
        style={[
          styles.memberCard,
          isSnoozed && styles.memberCardSnoozed,
          hasAlerts && styles.memberCardAlert,
        ]}
        onPress={() => handleMemberPress(item.groupMemberId)}
        activeOpacity={0.7}
      >
        <View style={styles.memberInfo}>
          {item.avatarUrl ? (
            <Image
              source={{ uri: item.avatarUrl }}
              style={styles.avatarImage}
            />
          ) : (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {item.firstName.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}

          <View style={styles.memberDetails}>
            <View style={styles.nameRow}>
              <Text style={styles.memberName}>
                {item.firstName} {item.lastName}
              </Text>
              {item.scoreFactors?.dropoffDetected && (
                <View style={styles.dropoffBadge}>
                  <Text style={styles.dropoffBadgeText}>Drop-off</Text>
                </View>
              )}
              {item.scoreFactors?.activeInOtherGroups && (
                <View style={styles.activeElsewhereBadge}>
                  <Text style={styles.activeElsewhereBadgeText}>Active elsewhere</Text>
                </View>
              )}
              {isSnoozed && (
                <View style={styles.snoozeBadge}>
                  <Ionicons name="time-outline" size={12} color="#666" />
                  <Text style={styles.snoozeBadgeText}>
                    Until {formatDate(item.snoozedUntil)}
                  </Text>
                </View>
              )}
              {item.alerts?.map((label: string, i: number) => (
                <View key={i} style={styles.alertBadge}>
                  <Ionicons name="warning" size={12} color="#B45309" />
                  <Text style={styles.alertBadgeText}>{label}</Text>
                </View>
              ))}
            </View>
            {getMemberSubtitleLines(item).map((line, i) => (
              <Text key={i} style={styles.memberStats}>
                {line}
              </Text>
            ))}
          </View>
        </View>

        {/* Dynamic score circles from scoreConfig */}
        <View style={styles.scoreContainer}>
          {scoreConfig.map((sc) => {
            const value = getScoreValue(item, sc.id);
            const style = getScoreStyle(value);
            return (
              <View key={sc.id} style={styles.scoreItem}>
                <View style={[styles.scoreCircle, style.circle]}>
                  <Text style={[styles.scoreCircleText, style.text]}>
                    {value}%
                  </Text>
                </View>
                <Text style={styles.scoreLabel}>{sc.name}</Text>
              </View>
            );
          })}
        </View>
      </TouchableOpacity>
    );
  };

  const renderContent = () => {
    if (isLoading && (!members || members.length === 0)) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={styles.loadingText}>Loading follow-up list...</Text>
        </View>
      );
    }

    return (
      <FlatList
        data={members}
        keyExtractor={(item) => item._id || item.groupMemberId}
        renderItem={renderMember}
        contentContainerStyle={styles.listContent}
        onEndReached={() => {
          if (paginationStatus === "CanLoadMore") {
            loadMore(50);
          }
        }}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          paginationStatus === "LoadingMore" ? (
            <View style={styles.footerLoading}>
              <ActivityIndicator size="small" color={primaryColor} />
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="checkmark-circle-outline" size={64} color="#4CAF50" />
            <Text style={styles.emptyTitle}>All caught up!</Text>
            <Text style={styles.emptyText}>
              No members need follow-up right now.
            </Text>
          </View>
        }
      />
    );
  };

  return (
    <UserRoute>
      <DragHandle />
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={styles.headerTopRow}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={handleBack}
            testID="back-button"
          >
            <Ionicons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
          <View style={styles.headerContent}>
            <Text style={styles.headerTitle}>{toolDisplayName}</Text>
            <Text style={styles.headerSubtitle}>
              {group?.name || "Group"}
            </Text>
          </View>
          {/* Gear icon for settings */}
          <TouchableOpacity
            style={styles.settingsButton}
            onPress={handleSettingsPress}
          >
            <Ionicons name="settings-outline" size={22} color="#666" />
          </TouchableOpacity>
        </View>
        {/* Sort toggle row */}
        <View style={styles.sortToggleContainer}>
          <View style={styles.sortToggle}>
            {scoreConfig.length > 1 && (
              <TouchableOpacity
                key="__weighted__"
                style={[
                  styles.sortOption,
                  sortField === "__weighted__" && styles.sortOptionActive,
                ]}
                onPress={() => handleSortPress("__weighted__")}
              >
                <Text
                  style={[
                    styles.sortOptionText,
                    sortField === "__weighted__" && styles.sortOptionTextActive,
                  ]}
                >
                  Weighted
                </Text>
                {sortField === "__weighted__" && (
                  <Ionicons
                    name={sortDirection === "asc" ? "arrow-up" : "arrow-down"}
                    size={12}
                    color={primaryColor}
                    style={styles.sortArrow}
                  />
                )}
              </TouchableOpacity>
            )}
            {scoreConfig.map((sc) => (
              <TouchableOpacity
                key={sc.id}
                style={[
                  styles.sortOption,
                  sortField === sc.id && styles.sortOptionActive,
                ]}
                onPress={() => handleSortPress(sc.id)}
              >
                <Text
                  style={[
                    styles.sortOptionText,
                    sortField === sc.id && styles.sortOptionTextActive,
                  ]}
                >
                  {sc.name}
                </Text>
                {sortField === sc.id && (
                  <Ionicons
                    name={sortDirection === "asc" ? "arrow-up" : "arrow-down"}
                    size={12}
                    color={primaryColor}
                    style={styles.sortArrow}
                  />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      {renderContent()}
    </UserRoute>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: "#666",
  },
  footerLoading: {
    paddingVertical: 20,
    alignItems: "center",
  },
  header: {
    padding: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
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
    color: "#333",
  },
  headerSubtitle: {
    fontSize: 14,
    color: "#666",
    marginTop: 2,
  },
  settingsButton: {
    padding: 6,
    marginRight: 4,
  },
  sortToggleContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 12,
  },
  sortToggle: {
    flexDirection: "row",
    backgroundColor: "#f0f0f0",
    borderRadius: 8,
    padding: 2,
  },
  sortOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  sortArrow: {
    marginLeft: 2,
  },
  sortOptionActive: {
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
    elevation: 1,
  },
  sortOptionText: {
    fontSize: 12,
    color: "#666",
    fontWeight: "500",
  },
  sortOptionTextActive: {
    color: DEFAULT_PRIMARY_COLOR,
    fontWeight: "600",
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
  memberCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  memberCardSnoozed: {
    opacity: 0.6,
  },
  memberCardAlert: {
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  memberInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  avatarImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginRight: 12,
  },
  avatarText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "600",
  },
  memberDetails: {
    flex: 1,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  memberName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  dropoffBadge: {
    backgroundColor: "#FFF3E0",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  dropoffBadgeText: {
    fontSize: 10,
    color: "#F57C00",
    fontWeight: "600",
  },
  activeElsewhereBadge: {
    backgroundColor: "#E8F5E9",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  activeElsewhereBadgeText: {
    fontSize: 10,
    color: "#4CAF50",
    fontWeight: "600",
  },
  snoozeBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f0f0f0",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 4,
  },
  snoozeBadgeText: {
    fontSize: 10,
    color: "#666",
  },
  alertBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 4,
  },
  alertBadgeText: {
    fontSize: 10,
    color: "#B45309",
    fontWeight: "600",
  },
  memberStats: {
    fontSize: 13,
    color: "#666",
    marginTop: 2,
  },
  scoreContainer: {
    flexDirection: "row",
    gap: 8,
  },
  scoreItem: {
    alignItems: "center",
  },
  scoreLabel: {
    fontSize: 9,
    color: "#666",
    marginTop: 2,
    fontWeight: "500",
  },
  scoreCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    justifyContent: "center",
    alignItems: "center",
  },
  scoreCircleGood: {
    borderColor: "#4CAF50",
    backgroundColor: "#E8F5E9",
  },
  scoreCircleWarning: {
    borderColor: "#FF9800",
    backgroundColor: "#FFF3E0",
  },
  scoreCircleLow: {
    borderColor: "#FF5252",
    backgroundColor: "#FFEBEE",
  },
  scoreCircleText: {
    fontSize: 12,
    fontWeight: "700",
  },
  scoreGood: {
    color: "#4CAF50",
  },
  scoreWarning: {
    color: "#FF9800",
  },
  scoreLow: {
    color: "#FF5252",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#333",
    marginTop: 16,
  },
  emptyText: {
    fontSize: 14,
    color: "#666",
    marginTop: 8,
    textAlign: "center",
  },
});
