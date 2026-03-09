import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  api,
  Id,
  useAuthenticatedPaginatedQuery,
  useAuthenticatedMutation,
  useAuthenticatedQuery,
  useQuery,
} from "@services/api/convex";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import {
  SUBTITLE_VARIABLE_MAP,
  type SubtitleVariable,
  getScoreValue,
} from "./followupShared";
import {
  chunkIntoPages,
  parseFollowupQuerySyntax,
  type LeaderInfo,
  type ScoreConfigEntry,
} from "./followupGridHelpers";

type SortDirection = "asc" | "desc";

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
  missedMeetings: number;
  consecutiveMissed: number;
  lastAttendedAt?: number;
  lastFollowupAt?: number;
  status?: string;
  assigneeId?: string;
};

type LeaderRecord = {
  userId?: string;
  _id?: string;
  firstName?: string;
  lastName?: string;
  profilePhoto?: string;
};

type GridColumn = {
  key: string;
  label: string;
  width: number;
  sortable: boolean;
  kind: "score" | "status" | "text";
  getValue: (member: FollowupMember) => string | number;
};

const MIN_DATA_COL_WIDTH = 94;
const SWIPE_THRESHOLD = 50;
const MIN_COLUMNS_PER_PAGE = 4;
const MIN_PINNED_COL_WIDTH = 126;
const MAX_PINNED_COL_WIDTH = 152;

const STATUS_OPTIONS: Array<{ value?: string; label: string }> = [
  { value: "green", label: "Green" },
  { value: "orange", label: "Orange" },
  { value: "red", label: "Red" },
  { value: undefined, label: "Clear status" },
];

const SERVER_SORTABLE_FIELDS = new Set([
  "score1",
  "score2",
  "firstName",
  "lastName",
  "addedAt",
  "lastAttendedAt",
  "lastFollowupAt",
  "status",
  "assignee",
]);

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}

function getScoreStyles(value: number) {
  if (value >= 70) {
    return { border: "#4CAF50", bg: "#E8F5E9", text: "#2F855A" };
  }
  if (value >= 40) {
    return { border: "#FF9800", bg: "#FFF3E0", text: "#C05621" };
  }
  return { border: "#FF5252", bg: "#FFEBEE", text: "#C53030" };
}

function getStatusStyles(status?: string): { bg: string; text: string } {
  switch (status) {
    case "green":
      return { bg: "#DEF7EC", text: "#03543F" };
    case "orange":
      return { bg: "#FFF3E0", text: "#C2410C" };
    case "red":
      return { bg: "#FDE8E8", text: "#9B1C1C" };
    default:
      return { bg: "#F4F4F5", text: "#52525B" };
  }
}

function formatDate(timestamp?: number, emptyText = "Never"): string {
  if (!timestamp) return emptyText;
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function compareSortValues(
  a: string | number,
  b: string | number,
  direction: SortDirection
): number {
  const multiplier = direction === "asc" ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") {
    return (a - b) * multiplier;
  }
  return String(a).localeCompare(String(b), undefined, { sensitivity: "base" }) * multiplier;
}

export function FollowupMobileGrid({ groupId }: { groupId: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { primaryColor } = useCommunityTheme();

  const [sortField, setSortField] = useState("score1");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [searchQuery, setSearchQuery] = useState("");
  const [columnPageIndex, setColumnPageIndex] = useState(0);
  const [editSheet, setEditSheet] = useState<{
    type: "assignee" | "status";
    memberId: string;
  } | null>(null);
  const [isUpdatingField, setIsUpdatingField] = useState(false);
  const [localOverrides, setLocalOverrides] = useState<
    Record<string, { assigneeId?: string | null; status?: string | null }>
  >({});

  const debouncedSearch = useDebounce(searchQuery, 300);

  const config = useAuthenticatedQuery(
    api.functions.memberFollowups.getFollowupConfig,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip"
  );
  const scoreConfigScores = config?.scoreConfigScores;
  const scoreConfig = useMemo<ScoreConfigEntry[]>(
    () => scoreConfigScores ?? [],
    [scoreConfigScores]
  );
  const toolDisplayName =
    typeof config?.toolDisplayName === "string" ? config.toolDisplayName : "Follow-up";
  const memberSubtitle =
    typeof config?.memberSubtitle === "string" ? config.memberSubtitle : "";

  const leaders = useAuthenticatedQuery(
    api.functions.groups.members.getLeaders,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip"
  );
  const leaderMap = useMemo(() => {
    if (!leaders) return new Map<string, LeaderInfo>();
    const leaderRows = (leaders ?? []) as LeaderRecord[];
    return new Map(
      leaderRows.map((leader) => [
        leader.userId?.toString?.() ?? leader._id?.toString?.() ?? "",
        {
          firstName: leader.firstName ?? "",
          lastName: leader.lastName ?? "",
          profilePhoto: leader.profilePhoto,
        },
      ])
    );
  }, [leaders]);

  useEffect(() => {
    if (!sortField.startsWith("score")) return;
    const scoreIndex = Number.parseInt(sortField.replace("score", ""), 10) - 1;
    if (scoreConfig.length === 0) {
      setSortField("firstName");
      return;
    }
    if (scoreIndex < 0 || scoreIndex >= scoreConfig.length) {
      setSortField("score1");
    }
  }, [scoreConfig, sortField]);

  const parsedQuery = useMemo(
    () => parseFollowupQuerySyntax(debouncedSearch, leaderMap, scoreConfig),
    [debouncedSearch, leaderMap, scoreConfig]
  );
  const hasTextSearch = parsedQuery.searchText.length > 0;
  const hasStructuredFilters =
    !!parsedQuery.statusFilter ||
    !!parsedQuery.assigneeFilter ||
    parsedQuery.scoreMax !== undefined ||
    parsedQuery.scoreMin !== undefined;

  const listFilterArgs = useMemo(() => {
    const filters: Record<string, unknown> = {};
    if (parsedQuery.statusFilter) filters.statusFilter = parsedQuery.statusFilter;
    if (parsedQuery.assigneeFilter) filters.assigneeFilter = parsedQuery.assigneeFilter as Id<"users">;
    if (parsedQuery.scoreField) filters.scoreField = parsedQuery.scoreField;
    if (parsedQuery.scoreMax !== undefined) filters.scoreMax = parsedQuery.scoreMax;
    if (parsedQuery.scoreMin !== undefined) filters.scoreMin = parsedQuery.scoreMin;
    return filters;
  }, [parsedQuery]);

  const isClientSideSort = !SERVER_SORTABLE_FIELDS.has(sortField);
  const serverSortBy = SERVER_SORTABLE_FIELDS.has(sortField) ? sortField : "score1";
  const serverSortDirection = isClientSideSort ? "desc" : sortDirection;

  const {
    results: rawMembers,
    status: paginationStatus,
    loadMore,
    isLoading,
  } = useAuthenticatedPaginatedQuery(
    api.functions.memberFollowups.list,
    !hasTextSearch && groupId
      ? {
          groupId: groupId as Id<"groups">,
          sortBy: serverSortBy,
          sortDirection: serverSortDirection,
          ...listFilterArgs,
        }
      : "skip",
    { initialNumItems: 50 }
  );

  const searchResults = useAuthenticatedQuery(
    api.functions.memberFollowups.search,
    hasTextSearch && groupId
      ? {
          groupId: groupId as Id<"groups">,
          searchText: parsedQuery.searchText,
          ...(parsedQuery.statusFilter ? { statusFilter: parsedQuery.statusFilter } : {}),
          ...(parsedQuery.assigneeFilter
            ? { assigneeFilter: parsedQuery.assigneeFilter as Id<"users"> }
            : {}),
          ...(parsedQuery.scoreField ? { scoreField: parsedQuery.scoreField } : {}),
          ...(parsedQuery.scoreMax !== undefined ? { scoreMax: parsedQuery.scoreMax } : {}),
          ...(parsedQuery.scoreMin !== undefined ? { scoreMin: parsedQuery.scoreMin } : {}),
        }
      : "skip"
  );

  const totalCount = useAuthenticatedQuery(
    api.functions.memberFollowups.count,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip"
  );
  const setAssigneeMut = useAuthenticatedMutation(api.functions.memberFollowups.setAssignee);
  const setStatusMut = useAuthenticatedMutation(api.functions.memberFollowups.setStatus);

  const groupData = useQuery(
    api.functions.groups.index.getById,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip"
  );

  const getSortFieldValue = useCallback(
    (member: FollowupMember, field: string): string | number => {
      if (field.startsWith("score")) {
        const scoreIndex = Number.parseInt(field.replace("score", ""), 10) - 1;
        const scoreId = scoreConfig[scoreIndex]?.id;
        return scoreId ? getScoreValue(member, scoreId) : 0;
      }

      switch (field) {
        case "firstName":
          return member.firstName ?? "";
        case "lastName":
          return member.lastName ?? "";
        case "status":
          return member.status ?? "";
        case "assignee": {
          if (!member.assigneeId) return "";
          const leader = leaderMap.get(member.assigneeId);
          return leader ? `${leader.firstName} ${leader.lastName}`.trim() : "";
        }
        case "lastAttendedAt":
          return member.lastAttendedAt ?? 0;
        case "lastFollowupAt":
          return member.lastFollowupAt ?? 0;
        default:
          return 0;
      }
    },
    [scoreConfig, leaderMap]
  );

  const members = useMemo(() => {
    const source = (hasTextSearch ? searchResults ?? [] : rawMembers ?? []) as FollowupMember[];
    if (source.length === 0) return [];
    if (!hasTextSearch && !isClientSideSort) return source;

    const sorted = [...source];
    sorted.sort((a, b) =>
      compareSortValues(
        getSortFieldValue(a, sortField),
        getSortFieldValue(b, sortField),
        sortDirection
      )
    );
    return sorted;
  }, [
    hasTextSearch,
    searchResults,
    rawMembers,
    isClientSideSort,
    sortField,
    sortDirection,
    getSortFieldValue,
  ]);

  // Keep inline edits responsive while server updates stream in.
  const displayMembers = useMemo(() => {
    if (Object.keys(localOverrides).length === 0) return members;
    return members.map((member) => {
      const override = localOverrides[member.groupMemberId];
      if (!override) return member;
      return {
        ...member,
        assigneeId:
          override.assigneeId !== undefined
            ? override.assigneeId ?? undefined
            : member.assigneeId,
        status: override.status !== undefined ? override.status ?? undefined : member.status,
      };
    });
  }, [members, localOverrides]);

  useEffect(() => {
    if (Object.keys(localOverrides).length === 0) return;
    const memberMap = new Map(members.map((member) => [member.groupMemberId, member]));
    const next: typeof localOverrides = {};
    let changed = false;

    for (const [memberId, override] of Object.entries(localOverrides)) {
      const serverMember = memberMap.get(memberId);
      if (!serverMember) {
        next[memberId] = override;
        continue;
      }
      const pending: typeof override = {};
      if (override.assigneeId !== undefined) {
        const serverAssignee = serverMember.assigneeId ?? null;
        if (serverAssignee !== (override.assigneeId ?? null)) {
          pending.assigneeId = override.assigneeId;
        } else {
          changed = true;
        }
      }
      if (override.status !== undefined) {
        const serverStatus = serverMember.status ?? null;
        if (serverStatus !== (override.status ?? null)) {
          pending.status = override.status;
        } else {
          changed = true;
        }
      }
      if (Object.keys(pending).length > 0) {
        next[memberId] = pending;
      } else {
        changed = true;
      }
    }
    if (changed) {
      setLocalOverrides(next);
    }
  }, [members, localOverrides]);

  const dataColumns: GridColumn[] = useMemo(() => {
    const scoreColumns: GridColumn[] = scoreConfig.map((score, index) => ({
      key: `score${index + 1}`,
      label: score.name,
      width: 94,
      sortable: true,
      kind: "score",
      getValue: (member) => getScoreValue(member, score.id),
    }));

    const extraColumns: GridColumn[] = [
      {
        key: "status",
        label: "Status",
        width: 96,
        sortable: true,
        kind: "status",
        getValue: (member) => member.status ?? "none",
      },
      {
        key: "assignee",
        label: "Assignee",
        width: 124,
        sortable: true,
        kind: "text",
        getValue: (member) => {
          if (!member.assigneeId) return "Unassigned";
          const leader = leaderMap.get(member.assigneeId);
          if (!leader) return "Unassigned";
          return `${leader.firstName} ${leader.lastName}`.trim();
        },
      },
      {
        key: "alerts",
        label: "Alerts",
        width: 92,
        sortable: false,
        kind: "text",
        getValue: (member) => String(member.alerts?.length ?? 0),
      },
      {
        key: "missedMeetings",
        label: "Missed",
        width: 86,
        sortable: false,
        kind: "text",
        getValue: (member) => String(member.missedMeetings ?? 0),
      },
      {
        key: "consecutiveMissed",
        label: "Streak",
        width: 84,
        sortable: false,
        kind: "text",
        getValue: (member) => String(member.consecutiveMissed ?? 0),
      },
      {
        key: "lastAttendedAt",
        label: "Last Attended",
        width: 112,
        sortable: true,
        kind: "text",
        getValue: (member) => formatDate(member.lastAttendedAt, "\u2014"),
      },
      {
        key: "lastFollowupAt",
        label: "Last Follow-up",
        width: 116,
        sortable: true,
        kind: "text",
        getValue: (member) => formatDate(member.lastFollowupAt, "\u2014"),
      },
    ];

    return [...scoreColumns, ...extraColumns];
  }, [scoreConfig, leaderMap]);

  const pinnedColumnWidth = useMemo(
    () => Math.max(MIN_PINNED_COL_WIDTH, Math.min(MAX_PINNED_COL_WIDTH, Math.floor(width * 0.33))),
    [width]
  );
  const availableDataWidth = Math.max(MIN_DATA_COL_WIDTH, width - pinnedColumnWidth - 36);
  const columnsPerPage = Math.max(
    MIN_COLUMNS_PER_PAGE,
    Math.floor(availableDataWidth / MIN_DATA_COL_WIDTH)
  );
  const columnPages = useMemo(
    () => chunkIntoPages(dataColumns, columnsPerPage),
    [dataColumns, columnsPerPage]
  );

  useEffect(() => {
    setColumnPageIndex((currentPage) =>
      Math.max(0, Math.min(currentPage, columnPages.length - 1))
    );
  }, [columnPages.length]);

  const visibleColumns = columnPages[columnPageIndex] ?? [];
  const visibleColumnWidth = Math.max(
    36,
    Math.floor(availableDataWidth / Math.max(MIN_COLUMNS_PER_PAGE, visibleColumns.length || 1))
  );
  const canPageLeft = columnPageIndex > 0;
  const canPageRight = columnPageIndex < columnPages.length - 1;

  const goToPreviousPage = useCallback(() => {
    setColumnPageIndex((currentPage) => Math.max(0, currentPage - 1));
  }, []);

  const goToNextPage = useCallback(() => {
    setColumnPageIndex((currentPage) => Math.min(columnPages.length - 1, currentPage + 1));
  }, [columnPages.length]);

  const gridPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx <= -SWIPE_THRESHOLD) {
            goToNextPage();
          } else if (gesture.dx >= SWIPE_THRESHOLD) {
            goToPreviousPage();
          }
        },
      }),
    [goToNextPage, goToPreviousPage]
  );

  const handleSortPress = (field: string) => {
    if (field === sortField) {
      setSortDirection((prevDirection) => (prevDirection === "asc" ? "desc" : "asc"));
      return;
    }
    setSortField(field);
    setSortDirection("asc");
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.push("/(tabs)/chat");
    }
  };

  const handleMemberPress = (memberId: string) => {
    router.push(`/(user)/leader-tools/${groupId}/followup/${memberId}`);
  };

  const handleSettingsPress = () => {
    router.push(`/(user)/leader-tools/${groupId}/tool-settings/followup`);
  };

  const getMemberSubtitleLines = (member: FollowupMember): string[] => {
    if (!memberSubtitle) {
      return [
        `${member.missedMeetings} missed`,
        `Last: ${formatDate(member.lastAttendedAt, "Never")}`,
      ];
    }
    const variableIds: string[] = memberSubtitle.split(",").filter(Boolean);
    if (variableIds.length === 0) return [];
    return variableIds
      .map((id) => SUBTITLE_VARIABLE_MAP.get(id))
      .filter((value): value is SubtitleVariable => value !== undefined)
      .map((variable) => variable.render(member, (value) => formatDate(value, "Never")));
  };

  const sortOptions = useMemo(
    () => [
      ...scoreConfig.map((score, index) => ({ key: `score${index + 1}`, label: score.name })),
      { key: "firstName", label: "First" },
      { key: "status", label: "Status" },
      { key: "lastAttendedAt", label: "Last attended" },
      { key: "assignee", label: "Assignee" },
    ],
    [scoreConfig]
  );

  const activeFilterBadges = useMemo(() => {
    const badges: string[] = [];
    if (parsedQuery.statusFilter) badges.push(`status:${parsedQuery.statusFilter}`);
    if (parsedQuery.assigneeFilter) {
      const leader = leaderMap.get(parsedQuery.assigneeFilter);
      badges.push(
        leader ? `assignee:${leader.firstName}` : `assignee:${parsedQuery.assigneeFilter}`
      );
    }
    if (parsedQuery.scoreField) {
      const scoreIndex = Number.parseInt(parsedQuery.scoreField.replace("score", ""), 10) - 1;
      const scoreLabel = scoreConfig[scoreIndex]?.name ?? parsedQuery.scoreField;
      if (parsedQuery.scoreMin !== undefined) badges.push(`${scoreLabel}:>${parsedQuery.scoreMin}`);
      if (parsedQuery.scoreMax !== undefined) badges.push(`${scoreLabel}:<${parsedQuery.scoreMax}`);
    }
    if (parsedQuery.searchText) badges.push(`text:"${parsedQuery.searchText}"`);
    return badges;
  }, [parsedQuery, leaderMap, scoreConfig]);

  const leaderOptions = useMemo(() => {
    const leaderRows = (leaders ?? []) as LeaderRecord[];
    return leaderRows
      .map((leader) => ({
        id: leader.userId?.toString?.() ?? leader._id?.toString?.() ?? "",
        firstName: leader.firstName ?? "",
        lastName: leader.lastName ?? "",
      }))
      .filter((leader) => leader.id.length > 0);
  }, [leaders]);

  const activeEditMember = useMemo(() => {
    if (!editSheet) return null;
    return displayMembers.find((member) => member.groupMemberId === editSheet.memberId) ?? null;
  }, [editSheet, displayMembers]);

  const closeEditSheet = () => {
    if (isUpdatingField) return;
    setEditSheet(null);
  };

  const handleAssignChange = async (assigneeId?: string) => {
    if (!editSheet || !activeEditMember) return;
    const memberId = editSheet.memberId;

    setIsUpdatingField(true);
    setLocalOverrides((prev) => ({
      ...prev,
      [memberId]: {
        ...prev[memberId],
        assigneeId: assigneeId ?? null,
      },
    }));
    try {
      await setAssigneeMut({
        groupId: groupId as Id<"groups">,
        groupMemberId: memberId as Id<"groupMembers">,
        assigneeId: assigneeId ? (assigneeId as Id<"users">) : undefined,
      });
      setEditSheet(null);
    } catch (error) {
      console.error("[FollowupMobileGrid] Failed to set assignee:", error);
      Alert.alert("Could not update assignee", "Please try again.");
    } finally {
      setIsUpdatingField(false);
    }
  };

  const handleStatusChange = async (status?: string) => {
    if (!editSheet || !activeEditMember) return;
    const memberId = editSheet.memberId;

    setIsUpdatingField(true);
    setLocalOverrides((prev) => ({
      ...prev,
      [memberId]: {
        ...prev[memberId],
        status: status ?? null,
      },
    }));
    try {
      await setStatusMut({
        groupId: groupId as Id<"groups">,
        groupMemberId: memberId as Id<"groupMembers">,
        status: status ?? undefined,
      });
      setEditSheet(null);
    } catch (error) {
      console.error("[FollowupMobileGrid] Failed to set status:", error);
      Alert.alert("Could not update status", "Please try again.");
    } finally {
      setIsUpdatingField(false);
    }
  };

  const isSearchLoading = hasTextSearch && searchResults === undefined;
  const isInitialLoading = (!hasTextSearch && isLoading && members.length === 0) || isSearchLoading;

  const renderColumnHeader = (column: GridColumn) => {
    const isActiveSort = sortField === column.key;
    return (
      <TouchableOpacity
        key={column.key}
        style={[styles.headerCell, { width: visibleColumnWidth }]}
        disabled={!column.sortable}
        onPress={() => {
          if (column.sortable) handleSortPress(column.key);
        }}
      >
        <Text
          numberOfLines={1}
          style={[styles.headerCellText, !column.sortable && styles.headerCellTextMuted]}
        >
          {column.label}
        </Text>
        {isActiveSort && (
          <Ionicons
            name={sortDirection === "asc" ? "arrow-up" : "arrow-down"}
            size={12}
            color={primaryColor}
            style={styles.headerSortIcon}
          />
        )}
      </TouchableOpacity>
    );
  };

  const renderDataCell = (member: FollowupMember, column: GridColumn) => {
    const value = column.getValue(member);
    if (column.kind === "score" && typeof value === "number") {
      const scoreStyles = getScoreStyles(value);
      return (
        <View
          style={[
            styles.scorePill,
            { borderColor: scoreStyles.border, backgroundColor: scoreStyles.bg },
          ]}
        >
          <Text style={[styles.scorePillText, { color: scoreStyles.text }]}>{value}%</Text>
        </View>
      );
    }

    if (column.kind === "status") {
      const status = typeof value === "string" ? value : "none";
      const statusStyles = getStatusStyles(status);
      const label = status === "none" ? "None" : `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
      return (
        <View style={[styles.statusPill, { backgroundColor: statusStyles.bg }]}>
          <Text style={[styles.statusPillText, { color: statusStyles.text }]}>{label}</Text>
        </View>
      );
    }

    return (
      <Text style={styles.dataCellText} numberOfLines={1}>
        {String(value)}
      </Text>
    );
  };

  const renderMemberRow = ({ item }: { item: FollowupMember }) => {
    const subtitleLine = getMemberSubtitleLines(item)[0] ?? "No recent follow-up details";
    const hasAlerts = (item.alerts?.length ?? 0) > 0;
    const isSnoozed = item.isSnoozed && !!item.snoozedUntil && item.snoozedUntil > Date.now();

    return (
      <TouchableOpacity
        style={[
          styles.row,
          hasAlerts && styles.rowAlert,
          isSnoozed && styles.rowSnoozed,
        ]}
        activeOpacity={0.8}
        onPress={() => handleMemberPress(item.groupMemberId)}
      >
        <View style={[styles.pinnedCell, { width: pinnedColumnWidth }]}>
          {item.avatarUrl ? (
            <Image source={{ uri: item.avatarUrl }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarFallbackText}>{item.firstName?.[0]?.toUpperCase() ?? "?"}</Text>
            </View>
          )}

          <View style={styles.memberTextWrap}>
            <Text style={styles.memberName} numberOfLines={1}>
              {item.firstName} {item.lastName}
            </Text>
            <Text style={styles.memberSubtitle} numberOfLines={1}>
              {subtitleLine}
            </Text>
          </View>
        </View>

        <View style={styles.rowDataCells}>
          {visibleColumns.map((column) => {
            const isEditable = column.key === "assignee" || column.key === "status";
            if (!isEditable) {
              return (
                <View
                  key={`${item.groupMemberId}-${column.key}`}
                  style={[styles.dataCell, { width: visibleColumnWidth }]}
                >
                  {renderDataCell(item, column)}
                </View>
              );
            }

            return (
              <TouchableOpacity
                key={`${item.groupMemberId}-${column.key}`}
                style={[styles.dataCell, styles.editableCell, { width: visibleColumnWidth }]}
                activeOpacity={0.7}
                onPress={() => {
                  setEditSheet({
                    type: column.key === "assignee" ? "assignee" : "status",
                    memberId: item.groupMemberId,
                  });
                }}
              >
                {renderDataCell(item, column)}
                <Ionicons name="chevron-down" size={11} color="#6B7280" style={styles.editIcon} />
              </TouchableOpacity>
            );
          })}
        </View>
      </TouchableOpacity>
    );
  };

  if (isInitialLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={primaryColor} />
        <Text style={styles.loadingText}>Loading follow-up list...</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <View style={styles.headerTopRow}>
          <TouchableOpacity style={styles.backButton} onPress={handleBack} testID="back-button">
            <Ionicons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
          <View style={styles.headerContent}>
            <Text style={styles.headerTitle}>{toolDisplayName}</Text>
            <Text style={styles.headerSubtitle}>{groupData?.name || "Group"}</Text>
          </View>
          <TouchableOpacity style={styles.settingsButton} onPress={handleSettingsPress}>
            <Ionicons name="settings-outline" size={22} color="#666" />
          </TouchableOpacity>
        </View>

        <View style={styles.searchRow}>
          <Ionicons name="search" size={16} color="#777" style={styles.searchIcon} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={styles.searchInput}
            placeholder="Search, status:green, assignee:john, attendance:>50"
            placeholderTextColor="#9CA3AF"
            testID="followup-mobile-search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery("")} style={styles.clearSearchButton}>
              <Ionicons name="close-circle" size={18} color="#888" />
            </TouchableOpacity>
          )}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.sortOptionsContainer}
        >
          {sortOptions.map((option) => {
            const isActive = sortField === option.key;
            return (
              <TouchableOpacity
                key={option.key}
                style={[styles.sortChip, isActive && styles.sortChipActive]}
                onPress={() => handleSortPress(option.key)}
              >
                <Text style={[styles.sortChipText, isActive && styles.sortChipTextActive]}>
                  {option.label}
                </Text>
                {isActive && (
                  <Ionicons
                    name={sortDirection === "asc" ? "arrow-up" : "arrow-down"}
                    size={11}
                    color={primaryColor}
                  />
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {activeFilterBadges.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterBadgeRow}
          >
            {activeFilterBadges.map((badge, index) => (
              <View key={`${badge}-${index}`} style={styles.filterBadge}>
                <Text style={styles.filterBadgeText}>{badge}</Text>
              </View>
            ))}
          </ScrollView>
        )}

        <Text style={styles.resultMeta}>
          Showing {members.length}
          {typeof totalCount === "number" ? ` of ${totalCount}` : ""}
          {hasStructuredFilters || hasTextSearch ? " (filtered)" : ""}
        </Text>
      </View>

      <View style={styles.gridContainer} {...gridPanResponder.panHandlers}>
        <View style={styles.gridPagerRow}>
          <TouchableOpacity
            style={[styles.pageButton, !canPageLeft && styles.pageButtonDisabled]}
            onPress={goToPreviousPage}
            disabled={!canPageLeft}
          >
            <Ionicons name="chevron-back" size={16} color={canPageLeft ? "#444" : "#BBB"} />
          </TouchableOpacity>

          <Text style={styles.pageIndicator}>
            Columns {columnPageIndex + 1}/{columnPages.length}
          </Text>

          <TouchableOpacity
            style={[styles.pageButton, !canPageRight && styles.pageButtonDisabled]}
            onPress={goToNextPage}
            disabled={!canPageRight}
          >
            <Ionicons name="chevron-forward" size={16} color={canPageRight ? "#444" : "#BBB"} />
          </TouchableOpacity>
        </View>

        <View style={styles.headerRow}>
          <View style={[styles.pinnedHeaderCell, { width: pinnedColumnWidth }]}>
            <Text style={styles.pinnedHeaderText}>Member</Text>
          </View>
          <View style={styles.headerDataCells}>{visibleColumns.map(renderColumnHeader)}</View>
        </View>

        <FlatList
          data={displayMembers}
          keyExtractor={(item) => item._id || item.groupMemberId}
          renderItem={renderMemberRow}
          onEndReached={() => {
            if (!hasTextSearch && paginationStatus === "CanLoadMore") {
              loadMore(50);
            }
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            !hasTextSearch && paginationStatus === "LoadingMore" ? (
              <View style={styles.footerLoading}>
                <ActivityIndicator size="small" color={primaryColor} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="search-outline" size={42} color="#9CA3AF" />
              <Text style={styles.emptyTitle}>No matches</Text>
              <Text style={styles.emptyText}>
                {hasTextSearch || hasStructuredFilters
                  ? "No members match your search and filters."
                  : "No members need follow-up right now."}
              </Text>
            </View>
          }
          contentContainerStyle={styles.listContent}
        />
      </View>

      <Modal
        visible={!!editSheet}
        transparent
        animationType="fade"
        onRequestClose={closeEditSheet}
      >
        <Pressable style={styles.modalBackdrop} onPress={closeEditSheet}>
          <Pressable style={styles.editSheetCard} onPress={() => undefined}>
            <Text style={styles.editSheetTitle}>
              {editSheet?.type === "assignee" ? "Update assignee" : "Update status"}
            </Text>
            <Text style={styles.editSheetSubtitle}>
              {activeEditMember
                ? `${activeEditMember.firstName} ${activeEditMember.lastName}`
                : "Member"}
            </Text>

            {editSheet?.type === "assignee" ? (
              <ScrollView style={styles.optionList}>
                {leaderOptions.map((leader) => {
                  const isSelected = activeEditMember?.assigneeId === leader.id;
                  return (
                    <TouchableOpacity
                      key={leader.id}
                      style={[styles.optionRow, isSelected && styles.optionRowSelected]}
                      onPress={() => handleAssignChange(leader.id)}
                      disabled={isUpdatingField}
                    >
                      <Text style={styles.optionText}>
                        {leader.firstName} {leader.lastName}
                      </Text>
                      {isSelected && <Ionicons name="checkmark" size={16} color={primaryColor} />}
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity
                  style={styles.optionRow}
                  onPress={() => handleAssignChange(undefined)}
                  disabled={isUpdatingField}
                >
                  <Text style={styles.optionText}>Clear assignee</Text>
                </TouchableOpacity>
              </ScrollView>
            ) : (
              <View style={styles.optionList}>
                {STATUS_OPTIONS.map((option) => {
                  const isSelected = (activeEditMember?.status ?? undefined) === option.value;
                  return (
                    <TouchableOpacity
                      key={option.label}
                      style={[styles.optionRow, isSelected && styles.optionRowSelected]}
                      onPress={() => handleStatusChange(option.value)}
                      disabled={isUpdatingField}
                    >
                      <Text style={styles.optionText}>{option.label}</Text>
                      {isSelected && <Ionicons name="checkmark" size={16} color={primaryColor} />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F6F7FB",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 10,
    color: "#666",
  },
  header: {
    paddingHorizontal: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
    backgroundColor: "#FFF",
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  backButton: {
    marginRight: 10,
    padding: 4,
  },
  headerContent: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#111827",
  },
  headerSubtitle: {
    marginTop: 2,
    fontSize: 13,
    color: "#6B7280",
  },
  settingsButton: {
    padding: 6,
  },
  searchRow: {
    marginTop: 12,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#F9FAFB",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: "#111827",
    paddingVertical: 0,
  },
  clearSearchButton: {
    marginLeft: 6,
  },
  sortOptionsContainer: {
    marginTop: 10,
    paddingRight: 8,
    gap: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  sortChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFF",
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  sortChipActive: {
    borderColor: DEFAULT_PRIMARY_COLOR,
    backgroundColor: "#EEF6FF",
  },
  sortChipText: {
    fontSize: 12,
    color: "#4B5563",
    fontWeight: "600",
  },
  sortChipTextActive: {
    color: DEFAULT_PRIMARY_COLOR,
  },
  filterBadgeRow: {
    marginTop: 8,
    gap: 6,
    flexDirection: "row",
    alignItems: "center",
  },
  filterBadge: {
    borderRadius: 999,
    backgroundColor: "#EEF2FF",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  filterBadgeText: {
    color: "#3730A3",
    fontSize: 11,
    fontWeight: "600",
  },
  resultMeta: {
    marginTop: 8,
    fontSize: 12,
    color: "#6B7280",
    fontWeight: "500",
  },
  gridContainer: {
    flex: 1,
    paddingHorizontal: 10,
    paddingTop: 10,
  },
  gridPagerRow: {
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  pageButton: {
    height: 28,
    width: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  pageButtonDisabled: {
    backgroundColor: "#F4F4F5",
  },
  pageIndicator: {
    fontSize: 12,
    fontWeight: "600",
    color: "#4B5563",
  },
  headerRow: {
    flexDirection: "row",
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderBottomWidth: 0,
    backgroundColor: "#FFF",
  },
  pinnedHeaderCell: {
    borderRightWidth: 1,
    borderRightColor: "#E5E7EB",
    justifyContent: "center",
    paddingHorizontal: 8,
    height: 40,
    backgroundColor: "#F9FAFB",
  },
  pinnedHeaderText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#374151",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  headerDataCells: {
    flexDirection: "row",
    flex: 1,
    backgroundColor: "#F9FAFB",
  },
  headerCell: {
    height: 40,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    borderRightWidth: 1,
    borderRightColor: "#E5E7EB",
  },
  headerCellText: {
    fontSize: 11,
    color: "#374151",
    fontWeight: "700",
  },
  headerCellTextMuted: {
    color: "#6B7280",
  },
  headerSortIcon: {
    marginLeft: 4,
  },
  listContent: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    backgroundColor: "#FFF",
    paddingBottom: 88,
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
    backgroundColor: "#FFF",
  },
  rowAlert: {
    backgroundColor: "#FFF7ED",
  },
  rowSnoozed: {
    opacity: 0.66,
  },
  pinnedCell: {
    borderRightWidth: 1,
    borderRightColor: "#E5E7EB",
    paddingHorizontal: 7,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  avatarImage: {
    width: 26,
    height: 26,
    borderRadius: 13,
  },
  avatarFallback: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarFallbackText: {
    color: "#FFF",
    fontWeight: "700",
    fontSize: 11,
  },
  memberTextWrap: {
    flex: 1,
  },
  memberName: {
    fontSize: 13,
    color: "#111827",
    fontWeight: "700",
  },
  memberSubtitle: {
    marginTop: 2,
    fontSize: 10,
    color: "#6B7280",
  },
  rowDataCells: {
    flexDirection: "row",
    flex: 1,
  },
  dataCell: {
    minHeight: 48,
    borderRightWidth: 1,
    borderRightColor: "#F3F4F6",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 6,
  },
  editableCell: {
    flexDirection: "row",
    gap: 2,
  },
  editIcon: {
    marginLeft: 2,
  },
  dataCellText: {
    fontSize: 12,
    color: "#374151",
    fontWeight: "500",
  },
  scorePill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  scorePillText: {
    fontSize: 11,
    fontWeight: "700",
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: "700",
  },
  footerLoading: {
    paddingVertical: 12,
    alignItems: "center",
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 42,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    marginTop: 8,
    fontSize: 17,
    color: "#374151",
    fontWeight: "700",
  },
  emptyText: {
    marginTop: 6,
    fontSize: 13,
    color: "#6B7280",
    textAlign: "center",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.28)",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  editSheetCard: {
    backgroundColor: "#FFF",
    borderRadius: 14,
    maxHeight: "74%",
    paddingVertical: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  },
  editSheetTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
    paddingHorizontal: 16,
  },
  editSheetSubtitle: {
    marginTop: 2,
    marginBottom: 8,
    fontSize: 13,
    color: "#6B7280",
    paddingHorizontal: 16,
  },
  optionList: {
    maxHeight: 360,
  },
  optionRow: {
    minHeight: 42,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#F3F4F6",
  },
  optionRowSelected: {
    backgroundColor: "#EEF6FF",
  },
  optionText: {
    fontSize: 14,
    color: "#111827",
  },
});
