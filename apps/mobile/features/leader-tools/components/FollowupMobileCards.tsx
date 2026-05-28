import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  api,
  Id,
  useAuthenticatedMutation,
  useAuthenticatedPaginatedQuery,
  useAuthenticatedQuery,
  useQuery,
} from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import type { ThemeColors } from "@/theme/colors";
import { Avatar } from "@/components/ui/Avatar";
import { adaptCommunityPerson } from "./followupShared";

type CardMember = {
  _id: string;
  groupMemberId: string;
  userId: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  score1: number;
  score2: number;
  score3?: number;
  missedMeetings: number;
  consecutiveMissed: number;
  lastAttendedAt?: number;
  lastFollowupAt?: number;
  assigneeId?: string;
  assigneeIds?: string[];
  phone?: string;
  isLeader: boolean;
};

type LeaderInfo = {
  userId: string;
  firstName: string;
  lastName: string;
  profilePhoto?: string;
};

type ReachOutChannel = "followed_up" | "call" | "text";

const BAND_THRESHOLDS = {
  needsAttention: 40,
  watch: 70,
};

function scoreColor(value: number, colors: ThemeColors): string {
  if (value >= 70) return colors.success;
  if (value >= 40) return colors.warning;
  return colors.destructive;
}

function scoreBand(score3: number): "needs" | "watch" | "healthy" {
  if (score3 < BAND_THRESHOLDS.needsAttention) return "needs";
  if (score3 < BAND_THRESHOLDS.watch) return "watch";
  return "healthy";
}

function daysSince(ts?: number): number | null {
  if (!ts) return null;
  const ms = Date.now() - ts;
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

function buildReasonLine(m: CardMember): string {
  const lastFollowup = daysSince(m.lastFollowupAt);
  const parts: string[] = [];

  if (lastFollowup === null) {
    parts.push("No follow-up logged");
  } else if (lastFollowup <= 2) {
    parts.push(`${lastFollowup === 0 ? "Today" : lastFollowup === 1 ? "Yesterday" : `${lastFollowup}d ago`} · follow-up`);
  } else {
    parts.push(`${lastFollowup}d since contact`);
  }

  if (m.consecutiveMissed > 0) {
    parts.push(`missed last ${m.consecutiveMissed}`);
  }

  return parts.join(" · ");
}

export function FollowupMobileCards({
  groupId,
  enforcedAssigneeUserId,
  returnTo,
  onSwitchToTable,
}: {
  groupId: string;
  enforcedAssigneeUserId?: string;
  returnTo?: string | null;
  onSwitchToTable: () => void;
}) {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { community, user } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const currentUserId = user?.id as Id<"users"> | undefined;

  const [searchQuery, setSearchQuery] = useState("");
  const [sectionsExpanded, setSectionsExpanded] = useState<{
    needs: boolean;
    watch: boolean;
    healthy: boolean;
  }>({ needs: true, watch: true, healthy: false });

  const [reachOutTarget, setReachOutTarget] = useState<CardMember | null>(null);
  const [assignTarget, setAssignTarget] = useState<CardMember | null>(null);

  const groupData = useQuery(
    api.functions.groups.index.getById,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip",
  );

  const crossGroupConfig = useAuthenticatedQuery(
    api.functions.memberFollowups.getCrossGroupConfig,
    {},
  );
  const perGroupLeaders = useAuthenticatedQuery(
    api.functions.groups.members.getLeaders,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip",
  );

  const communityLeaders: LeaderInfo[] = useMemo(() => {
    const rows = (crossGroupConfig?.leaders ?? perGroupLeaders ?? []) as any[];
    return rows
      .map((l) => ({
        userId: String(l.userId ?? l._id ?? ""),
        firstName: l.firstName ?? "",
        lastName: l.lastName ?? "",
        profilePhoto: l.profilePhoto,
      }))
      .filter((l) => l.userId.length > 0);
  }, [crossGroupConfig?.leaders, perGroupLeaders]);

  const groupLeaders: LeaderInfo[] = useMemo(() => {
    const rows = (perGroupLeaders ?? []) as any[];
    return rows
      .map((l) => ({
        userId: String(l.userId ?? l._id ?? ""),
        firstName: l.firstName ?? "",
        lastName: l.lastName ?? "",
        profilePhoto: l.profilePhoto,
      }))
      .filter((l) => l.userId.length > 0);
  }, [perGroupLeaders]);

  const groupLeaderIds = useMemo(
    () => new Set(groupLeaders.map((l) => l.userId)),
    [groupLeaders],
  );

  const leaderMap = useMemo(() => {
    const map = new Map<string, LeaderInfo>();
    for (const l of communityLeaders) map.set(l.userId, l);
    return map;
  }, [communityLeaders]);

  const {
    results: rawMembers,
    status: paginationStatus,
    loadMore,
    isLoading,
  } = useAuthenticatedPaginatedQuery(
    api.functions.communityPeople.list,
    groupId
      ? {
          groupId: groupId as Id<"groups">,
          sortBy: "score3",
          sortDirection: "asc" as const,
          ...(enforcedAssigneeUserId
            ? {
                assigneeFilter: enforcedAssigneeUserId as Id<"users">,
                requireSelfAssignee: true as const,
              }
            : {}),
        }
      : "skip",
    { initialNumItems: 100 },
  );

  const members: CardMember[] = useMemo(
    () => (rawMembers ?? []).map(adaptCommunityPerson) as CardMember[],
    [rawMembers],
  );

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => {
      const name = `${m.firstName} ${m.lastName}`.toLowerCase();
      return name.includes(q);
    });
  }, [members, searchQuery]);

  const sections = useMemo(() => {
    const needs: CardMember[] = [];
    const watch: CardMember[] = [];
    const healthy: CardMember[] = [];
    for (const m of filtered) {
      if (m.isLeader) continue;
      const band = scoreBand(m.score3 ?? 0);
      if (band === "needs") needs.push(m);
      else if (band === "watch") watch.push(m);
      else healthy.push(m);
    }
    return { needs, watch, healthy };
  }, [filtered]);

  const handleMemberPress = (m: CardMember) => {
    router.push(`/(user)/leader-tools/${groupId}/followup/${m.groupMemberId}` as any);
  };

  const handleBack = () => {
    if (returnTo) router.push(returnTo as any);
    else if (router.canGoBack()) router.back();
    else router.push("/(tabs)/profile" as any);
  };

  const renderCard = (m: CardMember) => (
    <MemberCard
      key={m._id}
      member={m}
      colors={colors}
      leaderMap={leaderMap}
      groupLeaderIds={groupLeaderIds}
      primaryColor={primaryColor}
      onPress={() => handleMemberPress(m)}
      onReachOut={() => setReachOutTarget(m)}
      onAssign={() => setAssignTarget(m)}
    />
  );

  const renderSection = (
    key: "needs" | "watch" | "healthy",
    title: string,
    icon: string,
    iconColor: string,
    list: CardMember[],
  ) => {
    if (list.length === 0) return null;
    const expanded = sectionsExpanded[key];
    return (
      <View key={key} style={styles.section}>
        <Pressable
          style={styles.sectionHeader}
          onPress={() =>
            setSectionsExpanded((s) => ({ ...s, [key]: !s[key] }))
          }
        >
          <View style={styles.sectionHeaderLeft}>
            <Ionicons name={icon as any} size={14} color={iconColor} />
            <Text
              style={[
                styles.sectionTitle,
                { color: colors.textSecondary },
              ]}
            >
              {title} · {list.length}
            </Text>
          </View>
          <Ionicons
            name={expanded ? "chevron-down" : "chevron-forward"}
            size={16}
            color={colors.iconSecondary}
          />
        </Pressable>
        {expanded && <View style={styles.cardList}>{list.map(renderCard)}</View>}
      </View>
    );
  };

  if (!groupId || !community) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={primaryColor} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + 8, borderBottomColor: colors.border },
        ]}
      >
        <Pressable onPress={handleBack} hitSlop={12} style={styles.headerIcon}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Check-in</Text>
          {groupData?.name && (
            <Text
              style={[styles.headerSubtitle, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              {groupData.name}
            </Text>
          )}
        </View>
        <Pressable
          onPress={onSwitchToTable}
          hitSlop={12}
          style={styles.headerIcon}
          accessibilityLabel="Switch to table view"
        >
          <Ionicons name="grid-outline" size={22} color={colors.text} />
        </Pressable>
      </View>

      {/* Search */}
      <View style={[styles.searchWrap, { borderBottomColor: colors.border }]}>
        <View
          style={[
            styles.searchInner,
            { backgroundColor: colors.surfaceSecondary },
          ]}
        >
          <Ionicons name="search" size={16} color={colors.iconSecondary} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search people"
            placeholderTextColor={colors.textTertiary}
            style={[styles.searchInput, { color: colors.text }]}
          />
        </View>
      </View>

      {/* Sections */}
      {isLoading && members.length === 0 ? (
        <View style={[styles.center, { paddingTop: 60 }]}>
          <ActivityIndicator size="large" color={primaryColor} />
        </View>
      ) : (
        <FlatList
          data={
            sections.needs.length === 0 &&
            sections.watch.length === 0 &&
            sections.healthy.length === 0
              ? []
              : (["needs", "watch", "healthy"] as const)
          }
          keyExtractor={(k) => k}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (paginationStatus === "CanLoadMore") loadMore(50);
          }}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          renderItem={({ item }) => {
            if (item === "needs")
              return renderSection(
                "needs",
                "NEEDS ATTENTION",
                "alert-circle",
                colors.destructive,
                sections.needs,
              ) as React.ReactElement;
            if (item === "watch")
              return renderSection(
                "watch",
                "WATCH",
                "warning",
                colors.warning,
                sections.watch,
              ) as React.ReactElement;
            return renderSection(
              "healthy",
              "HEALTHY",
              "checkmark-circle",
              colors.success,
              sections.healthy,
            ) as React.ReactElement;
          }}
          ListEmptyComponent={
            <View style={[styles.center, { paddingTop: 80 }]}>
              <Text style={{ color: colors.textSecondary }}>
                No people to show.
              </Text>
            </View>
          }
        />
      )}

      {/* Reach Out sheet */}
      {reachOutTarget && (
        <ReachOutSheet
          member={reachOutTarget}
          groupId={groupId}
          colors={colors}
          primaryColor={primaryColor}
          onClose={() => setReachOutTarget(null)}
        />
      )}

      {/* Assignee picker sheet */}
      {assignTarget && (
        <AssigneePickerSheet
          member={assignTarget}
          groupLeaders={groupLeaders}
          communityLeaders={communityLeaders}
          groupLeaderIds={groupLeaderIds}
          currentUserId={currentUserId}
          colors={colors}
          primaryColor={primaryColor}
          onClose={() => setAssignTarget(null)}
        />
      )}
    </View>
  );
}

function MemberCard({
  member,
  colors,
  leaderMap,
  groupLeaderIds,
  primaryColor,
  onPress,
  onReachOut,
  onAssign,
}: {
  member: CardMember;
  colors: ThemeColors;
  leaderMap: Map<string, LeaderInfo>;
  groupLeaderIds: Set<string>;
  primaryColor: string;
  onPress: () => void;
  onReachOut: () => void;
  onAssign: () => void;
}) {
  const assigneeIds = member.assigneeIds ?? (member.assigneeId ? [member.assigneeId] : []);
  const groupLeaderAssignees = assigneeIds.filter((id) => groupLeaderIds.has(id));
  const communityOnlyAssignees = assigneeIds.filter((id) => !groupLeaderIds.has(id));

  const connection = member.score3 ?? 0;
  const attendance = member.score2 ?? 0;
  const service = member.score1 ?? 0;
  const reasonLine = buildReasonLine(member);

  const connectionLabel =
    connection < 40 ? "low" : connection < 70 ? "watch" : "strong";

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      {/* Top row: avatar + name + assignee chip */}
      <View style={styles.cardTopRow}>
        <Avatar
          name={`${member.firstName} ${member.lastName}`.trim()}
          imageUrl={member.avatarUrl}
          size={40}
        />
        <View style={styles.cardTopRowText}>
          <Text
            style={[styles.cardName, { color: colors.text }]}
            numberOfLines={1}
          >
            {member.firstName} {member.lastName}
          </Text>
          <Pressable onPress={onAssign} hitSlop={6}>
            {assigneeIds.length === 0 ? (
              <Text
                style={[styles.assigneeUnassigned, { color: colors.textTertiary }]}
              >
                Unassigned · tap to assign
              </Text>
            ) : groupLeaderAssignees.length > 0 ? (
              <View style={styles.assigneeRow}>
                <Ionicons name="star" size={11} color={primaryColor} />
                <Text
                  style={[styles.assigneeText, { color: colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {groupLeaderAssignees
                    .map((id) => {
                      const l = leaderMap.get(id);
                      return l ? `${l.firstName} ${l.lastName}`.trim() : "";
                    })
                    .filter(Boolean)
                    .join(", ")}
                  {communityOnlyAssignees.length > 0 &&
                    `  +${communityOnlyAssignees.length} community`}
                </Text>
              </View>
            ) : (
              <View style={styles.assigneeRow}>
                <Ionicons
                  name="alert-circle-outline"
                  size={11}
                  color={colors.warning}
                />
                <Text
                  style={[styles.assigneeText, { color: colors.warning }]}
                  numberOfLines={1}
                >
                  No group leader · {leaderMap.get(communityOnlyAssignees[0])?.firstName ?? "community"}
                </Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>

      {/* Scores */}
      <View style={styles.scoresRow}>
        <View style={styles.scoreCol}>
          <Text style={[styles.scoreLabel, { color: colors.textTertiary }]}>
            Connection
          </Text>
          <View style={styles.scoreValueRow}>
            <View
              style={[
                styles.scoreDot,
                { backgroundColor: scoreColor(connection, colors) },
              ]}
            />
            <Text
              style={[
                styles.scoreValueHero,
                { color: scoreColor(connection, colors) },
              ]}
            >
              {Math.round(connection)}
            </Text>
          </View>
          <Text
            style={[
              styles.scoreSubLabel,
              { color: scoreColor(connection, colors) },
            ]}
          >
            {connectionLabel}
          </Text>
        </View>

        <View style={styles.scoreCol}>
          <Text style={[styles.scoreLabel, { color: colors.textTertiary }]}>
            Attendance
          </Text>
          <Text
            style={[
              styles.scoreValueSecondary,
              { color: scoreColor(attendance, colors) },
            ]}
          >
            {Math.round(attendance)}%
          </Text>
        </View>

        <View style={styles.scoreCol}>
          <Text style={[styles.scoreLabel, { color: colors.textTertiary }]}>
            Service
          </Text>
          <Text
            style={[
              styles.scoreValueSecondary,
              { color: scoreColor(service, colors) },
            ]}
          >
            {Math.round(service)}%
          </Text>
        </View>
      </View>

      {/* Reason + reach out */}
      <View style={styles.cardFooter}>
        <Text
          style={[styles.reasonLine, { color: colors.textSecondary }]}
          numberOfLines={1}
        >
          {reasonLine}
        </Text>
        <Pressable
          onPress={onReachOut}
          style={[
            styles.reachOutBtn,
            { backgroundColor: primaryColor + "1A", borderColor: primaryColor },
          ]}
          hitSlop={4}
        >
          <Text style={[styles.reachOutBtnText, { color: primaryColor }]}>
            Reach out
          </Text>
          <Ionicons name="arrow-forward" size={12} color={primaryColor} />
        </Pressable>
      </View>
    </TouchableOpacity>
  );
}

function ReachOutSheet({
  member,
  groupId,
  colors,
  primaryColor,
  onClose,
}: {
  member: CardMember;
  groupId: string;
  colors: ThemeColors;
  primaryColor: string;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const addFollowup = useAuthenticatedMutation(
    api.functions.memberFollowups.add,
  );

  const channels: Array<{
    type: ReachOutChannel;
    icon: string;
    title: string;
    subtitle: string;
    requiresPhone: boolean;
  }> = [
    {
      type: "text",
      icon: "chatbubble-ellipses",
      title: "Text",
      subtitle: "Opens Messages · logs as text",
      requiresPhone: true,
    },
    {
      type: "call",
      icon: "call",
      title: "Call",
      subtitle: "Opens dialer · logs as call",
      requiresPhone: true,
    },
    {
      type: "followed_up",
      icon: "people",
      title: "Log in-person",
      subtitle: "Already saw them — no message sent",
      requiresPhone: false,
    },
  ];

  const handleChannel = async (channel: ReachOutChannel, requiresPhone: boolean) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      // Fire the external action first (open SMS / dialer) so iOS surfaces
      // the prompt before we close the sheet.
      if (requiresPhone) {
        if (!member.phone) {
          Alert.alert("No phone number", "This person doesn't have a phone number on file.");
          setSubmitting(false);
          return;
        }
        const url =
          channel === "text"
            ? `sms:${member.phone}`
            : `tel:${member.phone}`;
        const canOpen = await Linking.canOpenURL(url);
        if (canOpen) Linking.openURL(url);
      }

      await addFollowup({
        groupId: groupId as Id<"groups">,
        // `member.groupMemberId` from communityPeople is the communityPeople _id,
        // not a real groupMembers _id — send userId and resolve server-side.
        memberUserId: member.userId as Id<"users">,
        type: channel,
        content: note.trim() || undefined,
      });
      onClose();
    } catch (err) {
      console.error("[ReachOutSheet] failed:", err);
      Alert.alert("Could not log follow-up", "Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              paddingBottom: insets.bottom + 16,
            },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.sheetHandleWrap}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
          </View>
          <Text style={[styles.sheetTitle, { color: colors.text }]}>
            Reach out to {member.firstName} {member.lastName}
          </Text>

          {channels.map((c) => (
            <TouchableOpacity
              key={c.type}
              activeOpacity={0.7}
              onPress={() => handleChannel(c.type, c.requiresPhone)}
              disabled={submitting}
              style={[
                styles.channelRow,
                {
                  backgroundColor: colors.surfaceSecondary,
                  opacity: submitting ? 0.5 : 1,
                },
              ]}
            >
              <View
                style={[
                  styles.channelIconWrap,
                  { backgroundColor: primaryColor + "1A" },
                ]}
              >
                <Ionicons name={c.icon as any} size={18} color={primaryColor} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.channelTitle, { color: colors.text }]}>
                  {c.title}
                </Text>
                <Text
                  style={[styles.channelSubtitle, { color: colors.textSecondary }]}
                >
                  {c.subtitle}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.iconSecondary} />
            </TouchableOpacity>
          ))}

          <Text style={[styles.noteLabel, { color: colors.textSecondary }]}>
            Note (optional)
          </Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Add context for this follow-up…"
            placeholderTextColor={colors.textTertiary}
            multiline
            style={[
              styles.noteInput,
              {
                backgroundColor: colors.surfaceSecondary,
                color: colors.text,
                borderColor: colors.border,
              },
            ]}
          />

          <TouchableOpacity
            onPress={onClose}
            disabled={submitting}
            style={[styles.cancelBtn, { borderColor: colors.border }]}
          >
            <Text style={[styles.cancelBtnText, { color: colors.text }]}>
              Cancel
            </Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function AssigneePickerSheet({
  member,
  groupLeaders,
  communityLeaders,
  groupLeaderIds,
  currentUserId,
  colors,
  primaryColor,
  onClose,
}: {
  member: CardMember;
  groupLeaders: LeaderInfo[];
  communityLeaders: LeaderInfo[];
  groupLeaderIds: Set<string>;
  currentUserId?: string;
  colors: ThemeColors;
  primaryColor: string;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(member.assigneeIds ?? (member.assigneeId ? [member.assigneeId] : [])),
  );
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const setAssignees = useAuthenticatedMutation(
    api.functions.communityPeople.setAssignees,
  );

  const otherLeaders = useMemo(
    () => communityLeaders.filter((l) => !groupLeaderIds.has(l.userId)),
    [communityLeaders, groupLeaderIds],
  );

  const filterLeader = (l: LeaderInfo) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return `${l.firstName} ${l.lastName}`.toLowerCase().includes(q);
  };

  const toggle = (userId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const handleAssignToMe = () => {
    if (!currentUserId) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.add(currentUserId);
      return next;
    });
  };

  const handleSave = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await setAssignees({
        communityPeopleId: member.groupMemberId as Id<"communityPeople">,
        assigneeIds: Array.from(selectedIds) as Id<"users">[],
      });
      onClose();
    } catch (err) {
      console.error("[AssigneePickerSheet] failed:", err);
      Alert.alert("Could not update assignees", "Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleClear = () => setSelectedIds(new Set());

  const renderLeaderRow = (l: LeaderInfo) => {
    const checked = selectedIds.has(l.userId);
    return (
      <TouchableOpacity
        key={l.userId}
        onPress={() => toggle(l.userId)}
        activeOpacity={0.7}
        style={[styles.leaderRow, { borderBottomColor: colors.border }]}
      >
        <Avatar
          name={`${l.firstName} ${l.lastName}`.trim()}
          imageUrl={l.profilePhoto ?? null}
          size={32}
        />
        <Text style={[styles.leaderRowName, { color: colors.text }]} numberOfLines={1}>
          {l.firstName} {l.lastName}
        </Text>
        <Ionicons
          name={checked ? "checkbox" : "square-outline"}
          size={20}
          color={checked ? primaryColor : colors.iconSecondary}
        />
      </TouchableOpacity>
    );
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              paddingBottom: insets.bottom + 16,
              maxHeight: "85%",
            },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.sheetHandleWrap}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
          </View>
          <Text style={[styles.sheetTitle, { color: colors.text }]}>
            Assign {member.firstName} {member.lastName}
          </Text>

          <View
            style={[
              styles.searchInner,
              {
                backgroundColor: colors.surfaceSecondary,
                marginBottom: 8,
              },
            ]}
          >
            <Ionicons name="search" size={16} color={colors.iconSecondary} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search leaders"
              placeholderTextColor={colors.textTertiary}
              style={[styles.searchInput, { color: colors.text }]}
            />
          </View>

          {currentUserId && (
            <TouchableOpacity
              onPress={handleAssignToMe}
              activeOpacity={0.7}
              style={[
                styles.assignToMeBtn,
                { backgroundColor: primaryColor + "1A", borderColor: primaryColor },
              ]}
            >
              <Ionicons name="person" size={14} color={primaryColor} />
              <Text style={[styles.assignToMeText, { color: primaryColor }]}>
                Assign to me
              </Text>
            </TouchableOpacity>
          )}

          <ScrollView style={{ maxHeight: 360 }}>
            {groupLeaders.filter(filterLeader).length > 0 && (
              <>
                <Text
                  style={[styles.sectionLabel, { color: colors.textTertiary }]}
                >
                  GROUP LEADERS
                </Text>
                {groupLeaders.filter(filterLeader).map(renderLeaderRow)}
              </>
            )}
            {otherLeaders.filter(filterLeader).length > 0 && (
              <>
                <Text
                  style={[
                    styles.sectionLabel,
                    { color: colors.textTertiary, marginTop: 12 },
                  ]}
                >
                  OTHER COMMUNITY LEADERS
                </Text>
                {otherLeaders.filter(filterLeader).map(renderLeaderRow)}
              </>
            )}
          </ScrollView>

          <View style={styles.sheetActions}>
            <TouchableOpacity
              onPress={handleClear}
              disabled={submitting}
              style={[styles.cancelBtn, { borderColor: colors.border, flex: 1 }]}
            >
              <Text style={[styles.cancelBtnText, { color: colors.text }]}>
                Clear
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSave}
              disabled={submitting}
              style={[
                styles.saveBtn,
                { backgroundColor: primaryColor, flex: 1, opacity: submitting ? 0.6 : 1 },
              ]}
            >
              <Text style={[styles.saveBtnText, { color: "#fff" }]}>
                {submitting ? "Saving…" : "Save"}
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  headerIcon: { padding: 4 },
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: 22, fontWeight: "700" },
  headerSubtitle: { fontSize: 12, marginTop: 1 },
  searchWrap: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 0 },
  section: { paddingHorizontal: 12, paddingTop: 14 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
    marginBottom: 6,
  },
  sectionHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
  sectionTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  cardList: { gap: 8 },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 10,
  },
  cardTopRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardTopRowText: { flex: 1 },
  cardName: { fontSize: 15, fontWeight: "600" },
  assigneeUnassigned: { fontSize: 12, marginTop: 2 },
  assigneeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  assigneeText: { fontSize: 12, flexShrink: 1 },
  scoresRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 4,
  },
  scoreCol: { flex: 1, alignItems: "flex-start" },
  scoreLabel: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  scoreValueRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  scoreDot: { width: 6, height: 6, borderRadius: 3 },
  scoreValueHero: { fontSize: 26, fontWeight: "700", lineHeight: 30 },
  scoreSubLabel: { fontSize: 10, fontWeight: "600", marginTop: 0 },
  scoreValueSecondary: { fontSize: 16, fontWeight: "600", marginTop: 2 },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  reasonLine: { fontSize: 12, flex: 1 },
  reachOutBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  reachOutBtnText: { fontSize: 12, fontWeight: "600" },

  // Modal / sheet
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 6,
    gap: 8,
  },
  sheetHandleWrap: { alignItems: "center", paddingVertical: 6 },
  sheetHandle: { width: 36, height: 4, borderRadius: 2 },
  sheetTitle: { fontSize: 16, fontWeight: "700", marginBottom: 8 },
  channelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
    marginBottom: 6,
  },
  channelIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  channelTitle: { fontSize: 15, fontWeight: "600" },
  channelSubtitle: { fontSize: 12, marginTop: 1 },
  noteLabel: { fontSize: 11, fontWeight: "600", marginTop: 8, marginBottom: 4, letterSpacing: 0.4 },
  noteInput: {
    minHeight: 60,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    borderWidth: StyleSheet.hairlineWidth,
    textAlignVertical: "top",
  },
  cancelBtn: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 10,
  },
  cancelBtnText: { fontSize: 14, fontWeight: "600" },

  // Assignee picker
  assignToMeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 10,
  },
  assignToMeText: { fontSize: 14, fontWeight: "600" },
  sectionLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  leaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  leaderRowName: { flex: 1, fontSize: 14 },
  sheetActions: { flexDirection: "row", gap: 8, marginTop: 8 },
  saveBtn: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 10,
  },
  saveBtnText: { fontSize: 14, fontWeight: "700" },
});
