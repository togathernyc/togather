import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Platform,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useAuthenticatedQuery, useAuthenticatedPaginatedQuery, useAuthenticatedMutation, api } from "@services/api/convex";
import { Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { Avatar } from "@/components/ui/Avatar";
import { FollowupDetailContent } from "./FollowupDetailScreen";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { FollowupSettingsPanel } from "./FollowupSettingsPanel";
import { FollowupCsvImportModal } from "./FollowupCsvImportModal";
import { FollowupQuickAddPanel } from "./FollowupQuickAddPanel";
import type { CustomFieldDef } from "./ColumnPickerModal";
import { getScoreValue } from "./followupShared";
import {
  buildSelectOptionsBySlot,
  parseMultiSelectValues,
  toggleMultiSelectValue,
} from "./followupSelectFields";
import {
  applyFollowupSuggestion,
  applyParsedFollowupFilters,
  getDateAddedRangeArgs,
  getFollowupQueryHelperText,
  getFollowupSearchSuggestions,
  parseFollowupQuerySyntax,
  type LeaderInfo,
  type ScoreConfigEntry,
} from "./followupGridHelpers";

// ============================================================================
// Types
// ============================================================================

type SortDirection = "asc" | "desc";

type FollowupMember = {
  _id: string;
  groupMemberId: string;
  userId: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  email?: string;
  phone?: string;
  zipCode?: string;
  dateOfBirth?: number;
  latestNote?: string;
  latestNoteAt?: number;
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
  lastActiveAt?: number;
  addedAt?: number;
  status?: string;
  assigneeId?: string;
  assigneeIds?: string[];
  customText1?: string;
  customText2?: string;
  customText3?: string;
  customText4?: string;
  customText5?: string;
  customNum1?: number;
  customNum2?: number;
  customNum3?: number;
  customNum4?: number;
  customNum5?: number;
  customBool1?: boolean;
  customBool2?: boolean;
  customBool3?: boolean;
  customBool4?: boolean;
  customBool5?: boolean;
};

// Server-sortable columns — maps to indexes
const SERVER_SORT_KEYS: Record<string, string> = {
  score1: "score1",
  score2: "score2",
  firstName: "firstName",
  lastName: "lastName",
  addedAt: "addedAt",
  lastAttendedAt: "lastAttendedAt",
  lastFollowupAt: "lastFollowupAt",
  lastActiveAt: "lastActiveAt",
  status: "status",
  assignee: "assignee",
  customText1: "customText1",
  customText2: "customText2",
  customText3: "customText3",
  customNum1: "customNum1",
  customNum2: "customNum2",
  customNum3: "customNum3",
  customBool1: "customBool1",
  customBool2: "customBool2",
  customBool3: "customBool3",
};

type ColumnDef = {
  key: string;
  label: string;
  defaultWidth: number;
  sortable: boolean;
  serverSortKey?: string;
};

// Built-in editable columns that get a visual highlight
const BUILTIN_EDITABLE_COLUMNS = new Set(["assignee", "status"]);

type DropdownPosition = {
  top: number;
  left: number;
  width: number;
};

// ============================================================================
// Helpers
// ============================================================================

function getScoreColor(value: number): string {
  if (value >= 70) return "#4CAF50";
  if (value >= 40) return "#FF9800";
  return "#FF5252";
}

function getScoreBgColor(value: number): string {
  if (value >= 70) return "#E8F5E9";
  if (value >= 40) return "#FFF3E0";
  return "#FFEBEE";
}

function formatShortDate(timestamp: number | undefined): string {
  if (!timestamp) return "\u2014";
  const date = new Date(timestamp);
  const now = new Date();
  const opts: Intl.DateTimeFormatOptions =
    date.getFullYear() === now.getFullYear()
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" };
  return date.toLocaleDateString("en-US", opts);
}

function getStatusColor(status?: string): { bg: string; text: string } {
  switch (status) {
    case "green":
      return { bg: "#DEF7EC", text: "#03543F" };
    case "orange":
      return { bg: "#FFF3E0", text: "#C2410C" };
    case "red":
      return { bg: "#FDE8E8", text: "#9B1C1C" };
    default:
      return { bg: "transparent", text: "#666" };
  }
}

const STATUS_OPTIONS = [
  { value: "green", label: "Green", color: "#DEF7EC" },
  { value: "orange", label: "Orange", color: "#FFF3E0" },
  { value: "red", label: "Red", color: "#FDE8E8" },
  { value: undefined, label: "Clear", color: "transparent" },
] as const;

const STORAGE_PREFIX = "followup-col-widths-";
const MIN_COL_WIDTH = 60;

// ============================================================================
// Debounce hook
// ============================================================================

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}

// ============================================================================
// Component
// ============================================================================

export function FollowupDesktopTable({ groupId }: { groupId: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const currentUserId = user?.id as Id<"users"> | undefined;
  const { primaryColor } = useCommunityTheme();

  // Sort state
  const [sortField, setSortField] = useState<string>("score1");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const debouncedSearch = useDebounce(searchQuery, 300);

  // Side sheet
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [scrollToNotes, setScrollToNotes] = useState(false);
  const [scrollToTasks, setScrollToTasks] = useState(false);

  // Inline editing
  const [editingInlineField, setEditingInlineField] = useState<string | null>(null);
  const [inlineFieldValue, setInlineFieldValue] = useState("");

  // Dropdowns — portal-based
  const [assigneeDropdownFor, setAssigneeDropdownFor] = useState<string | null>(null);
  const [statusDropdownFor, setStatusDropdownFor] = useState<string | null>(null);
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [dropdownPos, setDropdownPos] = useState<DropdownPosition | null>(null);

  // Row hover (web only)
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);

  // Optimistic updates — instant UI while mutation round-trips
  const [optimistic, setOptimistic] = useState<Record<string, { assigneeIds?: string[] | null; status?: string | null; [key: string]: any }>>({});

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  // Settings panel state
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [showQuickAddPanel, setShowQuickAddPanel] = useState(false);
  const [showCsvImportModal, setShowCsvImportModal] = useState(false);

  // Custom field dropdown state
  const [customDropdownFor, setCustomDropdownFor] = useState<{ memberId: string; slot: string } | null>(null);

  // Config query
  const config = useAuthenticatedQuery(
    api.functions.memberFollowups.getFollowupConfig,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip"
  );
  const scoreConfig: ScoreConfigEntry[] = config?.scoreConfigScores ?? [];
  const toolDisplayName = config?.toolDisplayName ?? "Follow-up";
  const columnConfig = config?.followupColumnConfig ?? null;
  const customFields: CustomFieldDef[] = (columnConfig?.customFields ?? []) as CustomFieldDef[];

  // Leaders query (for assignee picker) — needs auth token
  const leaders = useAuthenticatedQuery(
    api.functions.groups.members.getLeaders,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip"
  );

  // Group tasks — used to build per-member task counts for the table
  const groupTasks = useAuthenticatedQuery(
    api.functions.tasks.listGroup,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip"
  );

  const tasksByMember = useMemo(() => {
    const map = new Map<string, Array<{ _id: string; title: string; status: string; assignedToName?: string; groupName?: string }>>();
    if (!groupTasks) return map;
    for (const task of groupTasks as any[]) {
      if (task.status !== "open" || !task.targetMemberId) continue;
      const memberId = task.targetMemberId.toString();
      if (!map.has(memberId)) map.set(memberId, []);
      map.get(memberId)!.push({
        _id: task._id,
        title: task.title,
        status: task.status,
        assignedToName: task.assignedToName,
        groupName: task.groupName,
      });
    }
    return map;
  }, [groupTasks]);

  // Assignee lookup
  const leaderMap = useMemo(() => {
    if (!leaders) return new Map<string, LeaderInfo>();
    return new Map(
      (leaders as any[]).map((l: any) => [
        l.userId?.toString?.() ?? l._id?.toString?.() ?? "",
        { firstName: l.firstName ?? "", lastName: l.lastName ?? "", profilePhoto: l.profilePhoto },
      ])
    );
  }, [leaders]);
  const leaderOptions = useMemo(() => {
    if (!leaders) return [] as Array<{ id: string; firstName: string; lastName: string }>;
    return (leaders as any[])
      .map((leader: any) => ({
        id: leader.userId?.toString?.() ?? leader._id?.toString?.() ?? "",
        firstName: leader.firstName ?? "",
        lastName: leader.lastName ?? "",
      }))
      .filter((leader: any) => leader.id.length > 0);
  }, [leaders]);

  // Parse search query
  const parsedQuery = useMemo(
    () => parseFollowupQuerySyntax(debouncedSearch, leaderMap, scoreConfig),
    [debouncedSearch, leaderMap, scoreConfig],
  );
  const hasTextSearch = !!parsedQuery.searchText;
  const hasAnyFilter = !!parsedQuery.statusFilter || !!parsedQuery.assigneeFilter ||
    parsedQuery.scoreMin !== undefined ||
    parsedQuery.scoreMax !== undefined ||
    parsedQuery.excludedAssigneeFilters.length > 0 ||
    !!parsedQuery.dateAddedFilter;
  const searchSuggestions = useMemo(
    () => getFollowupSearchSuggestions(searchQuery, scoreConfig),
    [searchQuery, scoreConfig]
  );
  const searchHelperText = useMemo(
    () => getFollowupQueryHelperText(searchQuery, scoreConfig),
    [searchQuery, scoreConfig]
  );
  const showSearchSuggestions =
    isSearchFocused && searchQuery.trim().length > 0 && searchSuggestions.length > 0;

  // Build columns dynamically based on score config + column config
  const columns: ColumnDef[] = useMemo(() => {
    // System columns (always first, not configurable)
    const systemCols: ColumnDef[] = [
      { key: "checkbox", label: "", defaultWidth: 40, sortable: false },
      { key: "rowNum", label: "#", defaultWidth: 44, sortable: false },
    ];

    // All available non-system columns (built-in + score + custom)
    const allAvailable: ColumnDef[] = [
      { key: "addedAt", label: "Date Added", defaultWidth: 100, sortable: true, serverSortKey: "addedAt" },
      { key: "firstName", label: "First Name", defaultWidth: 150, sortable: true, serverSortKey: "firstName" },
      { key: "lastName", label: "Last Name", defaultWidth: 120, sortable: true, serverSortKey: "lastName" },
      { key: "email", label: "Email", defaultWidth: 180, sortable: false },
      { key: "phone", label: "Phone", defaultWidth: 140, sortable: false },
      { key: "zipCode", label: "ZIP Code", defaultWidth: 100, sortable: false },
      { key: "dateOfBirth", label: "Birthday", defaultWidth: 110, sortable: false },
    ];

    // Score columns — only score1 and score2 have server-side indexes;
    // score3+ are still sortable but use client-side sorting (no serverSortKey).
    scoreConfig.forEach((sc, i) => {
      const key = `score${i + 1}`;
      allAvailable.push({
        key,
        label: sc.name,
        defaultWidth: 100,
        sortable: true,
        serverSortKey: key in SERVER_SORT_KEYS ? key : undefined,
      });
    });

    allAvailable.push(
      { key: "assignee", label: "Assignees", defaultWidth: 140, sortable: true, serverSortKey: "assignee" },
      { key: "notes", label: "Notes", defaultWidth: 200, sortable: false },
      { key: "tasks", label: "Tasks", defaultWidth: 220, sortable: false },
      { key: "status", label: "Status", defaultWidth: 100, sortable: true, serverSortKey: "status" },
      { key: "lastAttendedAt", label: "Last Attended", defaultWidth: 120, sortable: true, serverSortKey: "lastAttendedAt" },
      { key: "lastFollowupAt", label: "Last Follow-up", defaultWidth: 120, sortable: true, serverSortKey: "lastFollowupAt" },
      { key: "lastActiveAt", label: "Date Active", defaultWidth: 120, sortable: true, serverSortKey: "lastActiveAt" },
      { key: "alerts", label: "Alerts", defaultWidth: 120, sortable: false },
    );

    // Custom field columns
    for (const cf of customFields) {
      const sortKey = cf.slot in SERVER_SORT_KEYS ? SERVER_SORT_KEYS[cf.slot] : undefined;
      allAvailable.push({
        key: cf.slot,
        label: cf.name,
        defaultWidth: cf.type === "boolean" ? 100 : 140,
        sortable: !!sortKey,
        serverSortKey: sortKey,
      });
    }

    // Apply column order from config
    const columnOrder = columnConfig?.columnOrder ?? [];
    const hiddenSet = new Set(columnConfig?.hiddenColumns ?? []);

    let ordered: ColumnDef[];
    if (columnOrder.length > 0) {
      const byKey = new Map(allAvailable.map((c) => [c.key, c]));
      ordered = [];
      for (const key of columnOrder) {
        const col = byKey.get(key);
        if (col) ordered.push(col);
      }
      // Append any columns not in the order (new columns since config was saved)
      const orderSet = new Set(columnOrder);
      for (const col of allAvailable) {
        if (!orderSet.has(col.key)) ordered.push(col);
      }
    } else {
      ordered = allAvailable;
    }

    // Filter out hidden columns
    const visible = ordered.filter((c) => !hiddenSet.has(c.key));

    return [...systemCols, ...visible];
  }, [scoreConfig, customFields, columnConfig]);

  // Editable columns (built-in + all custom field slots)
  const editableColumns = useMemo(() => {
    const set = new Set(BUILTIN_EDITABLE_COLUMNS);
    for (const cf of customFields) {
      set.add(cf.slot);
    }
    return set;
  }, [customFields]);

  // Column widths (resizable)
  const [colWidths, setColWidths] = useState<Record<string, number>>({});

  // Load from localStorage
  useEffect(() => {
    if (Platform.OS !== "web") return;
    try {
      const stored = localStorage.getItem(STORAGE_PREFIX + groupId);
      if (stored) setColWidths(JSON.parse(stored));
    } catch { /* localStorage unavailable */ }
  }, [groupId]);

  // Save to localStorage
  const saveColWidths = useCallback(
    (widths: Record<string, number>) => {
      if (Platform.OS !== "web") return;
      try {
        localStorage.setItem(STORAGE_PREFIX + groupId, JSON.stringify(widths));
      } catch { /* localStorage unavailable */ }
    },
    [groupId]
  );

  const getColWidth = (col: ColumnDef) => colWidths[col.key] ?? col.defaultWidth;

  // Server sort key — score3+ have no server index, use client-side sorting
  const isClientSideSort = !(sortField in SERVER_SORT_KEYS);

  const serverSortBy = useMemo(() => {
    if (sortField in SERVER_SORT_KEYS) return SERVER_SORT_KEYS[sortField];
    return "score1";
  }, [sortField]);

  // Build filter args for list query (structured filters only, no text search)
  const listFilterArgs = useMemo(() => {
    const args: any = {};
    const dateRangeArgs = getDateAddedRangeArgs(parsedQuery.dateAddedFilter);
    if (parsedQuery.statusFilter) args.statusFilter = parsedQuery.statusFilter;
    if (parsedQuery.assigneeFilter) args.assigneeFilter = parsedQuery.assigneeFilter as Id<"users">;
    if (parsedQuery.excludedAssigneeFilters.length > 0) {
      args.excludedAssigneeFilters = parsedQuery.excludedAssigneeFilters as Id<"users">[];
    }
    if (parsedQuery.scoreField) args.scoreField = parsedQuery.scoreField;
    if (parsedQuery.scoreMax !== undefined) args.scoreMax = parsedQuery.scoreMax;
    if (parsedQuery.scoreMin !== undefined) args.scoreMin = parsedQuery.scoreMin;
    if (dateRangeArgs.addedAtMin !== undefined) args.addedAtMin = dateRangeArgs.addedAtMin;
    if (dateRangeArgs.addedAtMax !== undefined) args.addedAtMax = dateRangeArgs.addedAtMax;
    return args;
  }, [parsedQuery]);

  // Paginated query — used when there's NO text search
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
          sortDirection: isClientSideSort ? "desc" : sortDirection,
          ...listFilterArgs,
        }
      : "skip",
    { initialNumItems: 50 }
  );

  // Text search query — used when there IS text search
  const searchResults = useAuthenticatedQuery(
    api.functions.memberFollowups.search,
    hasTextSearch && groupId
      ? {
          groupId: groupId as Id<"groups">,
          searchText: parsedQuery.searchText,
          ...(parsedQuery.statusFilter ? { statusFilter: parsedQuery.statusFilter } : {}),
          ...(parsedQuery.assigneeFilter ? { assigneeFilter: parsedQuery.assigneeFilter as Id<"users"> } : {}),
          ...(parsedQuery.excludedAssigneeFilters.length > 0
            ? { excludedAssigneeFilters: parsedQuery.excludedAssigneeFilters as Id<"users">[] }
            : {}),
          ...(parsedQuery.scoreField ? { scoreField: parsedQuery.scoreField } : {}),
          ...(parsedQuery.scoreMax !== undefined ? { scoreMax: parsedQuery.scoreMax } : {}),
          ...(parsedQuery.scoreMin !== undefined ? { scoreMin: parsedQuery.scoreMin } : {}),
          ...getDateAddedRangeArgs(parsedQuery.dateAddedFilter),
        }
      : "skip"
  );

  // Total member count
  const totalCount = useAuthenticatedQuery(
    api.functions.memberFollowups.count,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip"
  );

  // Merge: use search results when text search active, otherwise paginated.
  // Apply client-side sorting for score3+ (no server index).
  const members = useMemo(() => {
    const raw = (hasTextSearch
      ? (searchResults ?? [])
      : (rawMembers ?? [])
    ) as unknown as FollowupMember[];
    const filtered = applyParsedFollowupFilters(raw, parsedQuery);

    if (!isClientSideSort || filtered.length === 0) return filtered;

    // Client-side sort by the score column (e.g. score3, score4)
    // sortField is like "score3" — find the scoreConfig entry for it
    const scoreIdx = parseInt(sortField.replace("score", ""), 10) - 1;
    const scoreId = scoreConfig[scoreIdx]?.id;
    if (!scoreId) return filtered;

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      const aVal = getScoreValue(a, scoreId);
      const bVal = getScoreValue(b, scoreId);
      return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
    });
    return sorted;
  }, [
    hasTextSearch,
    searchResults,
    rawMembers,
    isClientSideSort,
    sortField,
    sortDirection,
    scoreConfig,
    parsedQuery,
  ]);

  // Merge optimistic overrides for consistent UI display
  const getAssigneeIds = useCallback((member: { assigneeId?: string; assigneeIds?: string[] }) => {
    const ids = (member.assigneeIds && member.assigneeIds.length > 0)
      ? member.assigneeIds
      : (member.assigneeId ? [member.assigneeId] : []);
    return Array.from(new Set(ids));
  }, []);

  const displayMembers = useMemo(() => {
    if (Object.keys(optimistic).length === 0) return members;
    return members.map((member) => {
      const opt = optimistic[member.groupMemberId];
      if (!opt) return member;
      const overrides: any = {};
      if (opt.assigneeIds !== undefined) {
        const nextIds = opt.assigneeIds ?? [];
        overrides.assigneeIds = nextIds.length > 0 ? nextIds : undefined;
        overrides.assigneeId = nextIds[0];
      }
      if (opt.status !== undefined) overrides.status = opt.status ?? undefined;
      for (const [key, val] of Object.entries(opt)) {
        if (key.startsWith("custom")) overrides[key] = val ?? undefined;
      }
      return { ...member, ...overrides };
    });
  }, [members, optimistic]);

  const selectOptionsBySlot = useMemo(
    () => buildSelectOptionsBySlot(customFields, displayMembers as unknown as Record<string, unknown>[]),
    [customFields, displayMembers]
  );

  // Clear optimistic overrides once server data catches up
  useEffect(() => {
    if (Object.keys(optimistic).length === 0) return;
    const memberMap = new Map(members.map((m) => [m.groupMemberId, m]));
    const next: typeof optimistic = {};
    let changed = false;
    for (const [id, overrides] of Object.entries(optimistic)) {
      const server = memberMap.get(id);
      if (!server) { next[id] = overrides; continue; }
      const remaining: typeof overrides = {};
      for (const [key, val] of Object.entries(overrides)) {
        if (key === "assigneeIds") {
          const serverAssigneeIds = getAssigneeIds(server);
          const overrideAssigneeIds = val ?? [];
          const sameAssignees = JSON.stringify(serverAssigneeIds) === JSON.stringify(overrideAssigneeIds);
          if (!sameAssignees) {
            (remaining as any)[key] = val;
          } else {
            changed = true;
          }
          continue;
        }
        const serverVal = (server as any)[key] ?? null;
        if (val !== undefined && serverVal !== (val ?? null)) {
          (remaining as any)[key] = val;
        } else if (val !== undefined) {
          changed = true;
        }
      }
      if (Object.keys(remaining).length > 0) next[id] = remaining;
      else changed = true;
    }
    if (changed) setOptimistic(next);
  }, [members, optimistic, getAssigneeIds]);

  // Mutations
  const setAssigneeMut = useAuthenticatedMutation(api.functions.memberFollowups.setAssignee);
  const setStatusMut = useAuthenticatedMutation(api.functions.memberFollowups.setStatus);
  // Custom field mutation
  const setCustomFieldMut = useAuthenticatedMutation(api.functions.memberFollowups.setCustomField);
  const assigneeMutationQueueRef = useRef<Record<string, Promise<void>>>({});

  // Bulk remove mutations
  const removeGroupMember = useAuthenticatedMutation(api.functions.groupMembers.remove);
  const removeCommunityMember = useAuthenticatedMutation(api.functions.communities.removeMember);

  // Group data for header
  const groupData = useQuery(
    api.functions.groups.index.getById,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip"
  );

  // ── Handlers ──

  const handleSort = (colKey: string, serverKey?: string) => {
    const effectiveKey = serverKey || colKey;
    if (sortField === effectiveKey) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(effectiveKey);
      setSortDirection("asc");
    }
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.push("/(tabs)/chat");
    }
  };

  // ── Selection handlers ──

  const handleToggleSelect = useCallback((groupMemberId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupMemberId)) {
        next.delete(groupMemberId);
      } else {
        next.add(groupMemberId);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === members.length && members.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(members.map((m) => m.groupMemberId)));
    }
  }, [members, selectedIds.size]);

  // Prune selections when member list changes (search, removal, pagination)
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const currentIds = new Set(members.map((m) => m.groupMemberId));
    const pruned = new Set([...selectedIds].filter((id) => currentIds.has(id)));
    if (pruned.size !== selectedIds.size) {
      setSelectedIds(pruned);
    }
  }, [members, selectedIds]);

  const handleBulkRemove = async () => {
    if (selectedIds.size === 0) return;
    setIsRemoving(true);

    const isAnnouncement = !!groupData?.isAnnouncementGroup;
    const selectedMembers = members.filter((m) => selectedIds.has(m.groupMemberId));

    try {
      const results = await Promise.allSettled(
        selectedMembers.map((m) => {
          if (isAnnouncement) {
            return removeCommunityMember({
              communityId: groupData!.communityId,
              targetUserId: m.userId as Id<"users">,
            });
          } else {
            return removeGroupMember({
              groupId: groupId as Id<"groups">,
              userId: m.userId as Id<"users">,
            });
          }
        })
      );

      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;

      if (failed > 0) {
        Alert.alert(
          "Partial Failure",
          `${succeeded} removed successfully, ${failed} failed.`
        );
      }
    } catch (err) {
      console.error("[bulkRemove] failed:", err);
      Alert.alert("Error", "Failed to remove members. Please try again.");
    } finally {
      setIsRemoving(false);
      setShowRemoveModal(false);
      setSelectedIds(new Set());
    }
  };

  const handleSettingsPress = () => {
    setShowSettingsPanel(true);
    setShowQuickAddPanel(false);
    setSelectedMemberId(null);
  };

  const enqueueAssigneeUpdate = useCallback(
    (memberId: string, assigneeIds: string[]) => {
      const previous = assigneeMutationQueueRef.current[memberId] ?? Promise.resolve();
      const next = previous
        .catch(() => undefined)
        .then(() =>
          setAssigneeMut({
            groupId: groupId as Id<"groups">,
            groupMemberId: memberId as Id<"groupMembers">,
            assigneeIds: assigneeIds as Id<"users">[],
          })
        );
      assigneeMutationQueueRef.current[memberId] = next.finally(() => {
        if (assigneeMutationQueueRef.current[memberId] === next) {
          delete assigneeMutationQueueRef.current[memberId];
        }
      });
      return next;
    },
    [groupId, setAssigneeMut]
  );

  const handleAssigneeSelect = async (memberId: string, assigneeIds: string[]) => {
    const normalizedAssigneeIds = Array.from(new Set(assigneeIds));
    // Optimistic: update UI instantly
    setOptimistic((prev) => {
      return { ...prev, [memberId]: { ...prev[memberId], assigneeIds: normalizedAssigneeIds } };
    });
    try {
      await enqueueAssigneeUpdate(memberId, normalizedAssigneeIds);
    } catch (err) {
      console.error("[setAssignee] failed:", err);
      // Revert optimistic update on failure
      setOptimistic((prev) => {
        const next = { ...prev };
        if (next[memberId]) {
          delete next[memberId].assigneeIds;
          if (Object.keys(next[memberId]).length === 0) delete next[memberId];
        }
        return next;
      });
    }
  };

  const handleStatusSelect = async (memberId: string, status?: string) => {
    setOptimistic((prev) => ({ ...prev, [memberId]: { ...prev[memberId], status: status ?? null } }));
    setStatusDropdownFor(null);
    setDropdownPos(null);
    try {
      await setStatusMut({
        groupId: groupId as Id<"groups">,
        groupMemberId: memberId as Id<"groupMembers">,
        status: status || undefined,
      });
    } catch (err) {
      console.error("[setStatus] failed:", err);
      setOptimistic((prev) => {
        const next = { ...prev };
        if (next[memberId]) {
          delete next[memberId].status;
          if (Object.keys(next[memberId]).length === 0) delete next[memberId];
        }
        return next;
      });
    }
  };

  const handleCustomFieldSave = async (memberId: string, slot: string, value: any) => {
    setOptimistic((prev) => ({ ...prev, [memberId]: { ...prev[memberId], [slot]: value ?? null } }));
    setCustomDropdownFor(null);
    setDropdownPos(null);
    try {
      await setCustomFieldMut({
        groupId: groupId as Id<"groups">,
        groupMemberId: memberId as Id<"groupMembers">,
        slot,
        value: value ?? undefined,
      });
    } catch (err) {
      console.error("[setCustomField] failed:", err);
      setOptimistic((prev) => {
        const next = { ...prev };
        if (next[memberId]) {
          delete (next[memberId] as any)[slot];
          if (Object.keys(next[memberId]).length === 0) delete next[memberId];
        }
        return next;
      });
    }
  };

  const handleMultiSelectToggle = async (memberId: string, slot: string, rawServerValue: string | undefined | null, toggledOption: string) => {
    // Track values for rollback - set synchronously within setOptimistic
    let previousValue: string | null = null;
    let newValue: string | null = null;

    // Optimistic update WITHOUT closing dropdown
    // Compute value from current optimistic state (via prev) to avoid stale closure issues
    setOptimistic((prev) => {
      const existingOptimistic = (prev[memberId] as Record<string, any> | undefined)?.[slot];
      const currentValue = existingOptimistic !== undefined
        ? String(existingOptimistic ?? "")
        : String(rawServerValue ?? "");

      previousValue = currentValue || null;

      newValue = toggleMultiSelectValue(currentValue, toggledOption) ?? null;
      return { ...prev, [memberId]: { ...prev[memberId], [slot]: newValue } };
    });

    try {
      await setCustomFieldMut({
        groupId: groupId as Id<"groups">,
        groupMemberId: memberId as Id<"groupMembers">,
        slot,
        value: newValue || undefined,
      });
    } catch (err) {
      console.error("[setCustomField multiselect] failed:", err);
      // Restore to previous value instead of deleting slot to preserve other in-flight toggles
      setOptimistic((prev) => {
        const next = { ...prev };
        if (previousValue) {
          next[memberId] = { ...next[memberId], [slot]: previousValue };
        } else {
          if (next[memberId]) {
            delete (next[memberId] as any)[slot];
            if (Object.keys(next[memberId]).length === 0) delete next[memberId];
          }
        }
        return next;
      });
    }
  };

  // Open dropdown at fixed position from cell rect
  const openDropdownAtCell = useCallback((e: any, memberId: string, type: "assignee" | "status") => {
    if (Platform.OS !== "web") return;
    setCustomDropdownFor(null);  // Close any open custom dropdown
    const target = e.currentTarget ?? e.target;
    const rect = target?.getBoundingClientRect?.();
    if (rect) {
      setDropdownPos({ top: rect.bottom + 2, left: rect.left, width: Math.max(rect.width, 200) });
    }
    if (type === "assignee") {
      setAssigneeDropdownFor(memberId);
      setStatusDropdownFor(null);
      setAssigneeSearch("");
    } else {
      setStatusDropdownFor(memberId);
      setAssigneeDropdownFor(null);
    }
  }, []);

  // Column resize handler
  const resizeRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);

  const handleResizeStart = useCallback(
    (key: string, e: any) => {
      e.preventDefault?.();
      e.stopPropagation?.();
      const col = columns.find((c) => c.key === key);
      if (!col) return;
      const startWidth = colWidths[key] ?? col.defaultWidth;
      resizeRef.current = { key, startX: e.clientX ?? e.pageX, startWidth };

      const onMove = (ev: any) => {
        if (!resizeRef.current) return;
        const dx = (ev.clientX ?? ev.pageX) - resizeRef.current.startX;
        const newWidth = Math.max(MIN_COL_WIDTH, resizeRef.current.startWidth + dx);
        setColWidths((prev) => ({ ...prev, [resizeRef.current!.key]: newWidth }));
      };
      const onUp = () => {
        if (resizeRef.current) {
          setColWidths((prev) => {
            saveColWidths(prev);
            return prev;
          });
        }
        resizeRef.current = null;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [columns, colWidths, saveColWidths]
  );

  // Close dropdowns on outside click
  // Use "click" (not "mousedown") so onPress handlers on dropdown items fire before cleanup
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const wrappedHandler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target?.closest?.("[data-dropdown]")) return;
      setAssigneeDropdownFor(null);
      setStatusDropdownFor(null);
      setCustomDropdownFor(null);
      setDropdownPos(null);
    };
    document.addEventListener("click", wrappedHandler);
    return () => document.removeEventListener("click", wrappedHandler);
  }, []);

  const filteredLeaders = useMemo(() => {
    if (!leaders) return [];
    const search = assigneeSearch.toLowerCase();
    return (leaders as any[]).filter((l: any) => {
      const name = `${l.firstName ?? ""} ${l.lastName ?? ""}`.toLowerCase();
      return name.includes(search);
    });
  }, [leaders, assigneeSearch]);

  // Find the member associated with the currently open dropdown (for portal rendering)
  const activeDropdownMember = useMemo(() => {
    const id = assigneeDropdownFor ?? statusDropdownFor ?? customDropdownFor?.memberId;
    if (!id) return null;
    return displayMembers.find((m) => m.groupMemberId === id) ?? null;
  }, [assigneeDropdownFor, statusDropdownFor, customDropdownFor, displayMembers]);

  // ── Render helpers ──

  const renderCellContent = (col: ColumnDef, rawItem: FollowupMember, rowIndex: number) => {
    // Apply optimistic overrides for instant UI feedback
    const opt = optimistic[rawItem.groupMemberId];
    let item = rawItem;
    if (opt) {
      const overrides: any = {};
      if (opt.assigneeIds !== undefined) {
        const nextIds = opt.assigneeIds ?? [];
        overrides.assigneeIds = nextIds.length > 0 ? nextIds : undefined;
        overrides.assigneeId = nextIds[0];
      }
      if (opt.status !== undefined) overrides.status = opt.status ?? undefined;
      // Apply custom field overrides
      for (const [key, val] of Object.entries(opt)) {
        if (key.startsWith("custom")) overrides[key] = val ?? undefined;
      }
      item = { ...rawItem, ...overrides };
    }
    switch (col.key) {
      case "checkbox": {
        const isChecked = selectedIds.has(rawItem.groupMemberId);
        return (
          <TouchableOpacity
            onPress={(e: any) => {
              e.stopPropagation?.();
              handleToggleSelect(rawItem.groupMemberId);
            }}
            data-checkbox="true"
            style={s.checkboxTouchable}
          >
            <Ionicons
              name={isChecked ? "checkbox" : "square-outline"}
              size={18}
              color={isChecked ? primaryColor : "#9CA3AF"}
            />
          </TouchableOpacity>
        );
      }

      case "rowNum":
        return <Text style={s.rowNumText}>{rowIndex + 1}</Text>;

      case "addedAt":
        return <Text style={s.cellText}>{formatShortDate(item.addedAt)}</Text>;

      case "firstName":
        return (
          <View style={s.nameCellRow}>
            <Avatar name={`${item.firstName} ${item.lastName ?? ""}`} imageUrl={item.avatarUrl} size={24} />
            <Text style={s.cellText}>{item.firstName}</Text>
          </View>
        );

      case "lastName":
        return <Text style={s.cellText}>{item.lastName ?? ""}</Text>;

      case "email":
        return <Text style={[s.cellText, s.cellTextSmall]} numberOfLines={1}>{item.email ?? ""}</Text>;

      case "phone":
        return <Text style={s.cellText}>{item.phone ?? ""}</Text>;

      case "zipCode":
        return <Text style={s.cellText}>{item.zipCode ?? ""}</Text>;

      case "dateOfBirth":
        return <Text style={s.cellText}>{item.dateOfBirth ? new Date(item.dateOfBirth).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : ""}</Text>;

      case "lastAttendedAt":
        return <Text style={s.cellText}>{formatShortDate(item.lastAttendedAt)}</Text>;

      case "lastFollowupAt":
        return <Text style={s.cellText}>{formatShortDate(item.lastFollowupAt)}</Text>;

      case "lastActiveAt":
        return <Text style={s.cellText}>{formatShortDate(item.lastActiveAt)}</Text>;

      case "alerts":
        return (
          <View style={s.alertsCell}>
            {item.alerts?.map((label, i) => (
              <View key={i} style={s.alertChip}>
                <Text style={s.alertChipText}>{label}</Text>
              </View>
            ))}
          </View>
        );

      case "notes":
        return (
          <TouchableOpacity
            style={s.notesCell}
            data-notes="true"
            onPress={() => {
              setShowSettingsPanel(false);
              setSelectedMemberId(item.groupMemberId);
              setScrollToNotes(false);
              setScrollToTasks(false);
              requestAnimationFrame(() => setScrollToNotes(true));
            }}
          >
            <Text style={s.cellText} numberOfLines={2}>
              {item.latestNote || ""}
            </Text>
          </TouchableOpacity>
        );

      case "tasks": {
        const tasks = tasksByMember.get(item.userId) ?? [];
        if (tasks.length === 0) {
          return <Text style={s.cellText}>{"\u2014"}</Text>;
        }
        const visibleTasks = tasks.slice(0, 2);
        const overflow = tasks.length - 2;
        return (
          <TouchableOpacity
            style={s.tasksCell}
            data-tasks="true"
            onPress={() => {
              setShowSettingsPanel(false);
              setShowQuickAddPanel(false);
              setSelectedMemberId(item.groupMemberId);
              setScrollToNotes(false);
              setScrollToTasks(false);
              requestAnimationFrame(() => setScrollToTasks(true));
            }}
          >
            {visibleTasks.map((task) => (
              <View key={task._id} style={s.taskChip}>
                <Text style={s.taskChipText} numberOfLines={1}>
                  {task.assignedToName ?? "Unassigned"} — {task.title}
                </Text>
              </View>
            ))}
            {overflow > 0 && (
              <Text style={s.taskOverflowText}>+{overflow} more</Text>
            )}
          </TouchableOpacity>
        );
      }

      case "assignee": {
        const isOpen = assigneeDropdownFor === item.groupMemberId;
        const assigneeIds = getAssigneeIds(item);
        const assignees = assigneeIds
          .map((assigneeId) => ({ assigneeId, leader: leaderMap.get(assigneeId) }))
          .filter((entry) => !!entry.leader);
        return (
          <TouchableOpacity
            style={s.editableCellTouchable}
            data-dropdown="true"
            onPress={(e) => {
              if (isOpen) {
                setAssigneeDropdownFor(null);
                setDropdownPos(null);
              } else {
                openDropdownAtCell(e, item.groupMemberId, "assignee");
              }
            }}
          >
            {assignees.length > 0 ? (
              <View style={s.assigneeBadgesRow}>
                {assignees.slice(0, 2).map(({ assigneeId, leader }) => (
                  <View key={assigneeId} style={s.assigneeBadge}>
                    <Avatar
                      name={`${leader!.firstName} ${leader!.lastName}`}
                      imageUrl={leader!.profilePhoto}
                      size={20}
                    />
                    <Text style={s.assigneeBadgeText}>
                      {leader!.firstName}
                    </Text>
                  </View>
                ))}
                {assignees.length > 2 && (
                  <Text style={s.assigneeMoreText}>+{assignees.length - 2}</Text>
                )}
              </View>
            ) : (
              <Text style={s.cellPlaceholder}>Assign</Text>
            )}
          </TouchableOpacity>
        );
      }

      case "status": {
        const isOpen = statusDropdownFor === item.groupMemberId;
        const statusStyle = getStatusColor(item.status);
        return (
          <TouchableOpacity
            style={[s.editableCellTouchable, { backgroundColor: statusStyle.bg, borderRadius: 6 }]}
            data-dropdown="true"
            onPress={(e) => {
              if (isOpen) {
                setStatusDropdownFor(null);
                setDropdownPos(null);
              } else {
                openDropdownAtCell(e, item.groupMemberId, "status");
              }
            }}
          >
            <Text style={[s.statusText, { color: statusStyle.text }]}>
              {item.status ? item.status.charAt(0).toUpperCase() + item.status.slice(1) : "\u2014"}
            </Text>
          </TouchableOpacity>
        );
      }

      default: {
        // Score columns
        if (col.key.startsWith("score")) {
          const scoreIdx = parseInt(col.key.replace("score", ""), 10) - 1;
          const scoreId = scoreConfig[scoreIdx]?.id;
          if (!scoreId) return null;
          const value = getScoreValue(item, scoreId);
          return (
            <View style={[s.scoreCell, { backgroundColor: getScoreBgColor(value) }]}>
              <Text style={[s.scoreCellText, { color: getScoreColor(value) }]}>
                {value}%
              </Text>
            </View>
          );
        }

        // Custom field columns
        const cf = customFields.find((f) => f.slot === col.key);
        if (cf) {
          const rawValue = (item as any)[cf.slot];

          // Boolean: checkbox toggle
          if (cf.type === "boolean") {
            return (
              <TouchableOpacity
                style={s.editableCellTouchable}
                onPress={(e: any) => {
                  e.stopPropagation?.();
                  handleCustomFieldSave(item.groupMemberId, cf.slot, !rawValue);
                }}
              >
                <Ionicons
                  name={rawValue ? "checkbox" : "square-outline"}
                  size={18}
                  color={rawValue ? primaryColor : "#9CA3AF"}
                />
              </TouchableOpacity>
            );
          }

          // Multiselect: click to show portal dropdown with checkboxes
          if (cf.type === "multiselect") {
            const options = selectOptionsBySlot.get(cf.slot) ?? [];
            const hasOptions = options.length > 0;
            const selectedValues = parseMultiSelectValues(
              rawValue ? String(rawValue) : ""
            );
            return (
              <TouchableOpacity
                style={s.editableCellTouchable}
                data-dropdown="true"
                disabled={!hasOptions}
                onPress={(e) => {
                  if (!hasOptions) return;
                  setCustomDropdownFor({ memberId: item.groupMemberId, slot: cf.slot });
                  setAssigneeDropdownFor(null);
                  setStatusDropdownFor(null);
                  const target = (e as any).currentTarget ?? (e as any).target;
                  const rect = target?.getBoundingClientRect?.();
                  if (rect) {
                    setDropdownPos({ top: rect.bottom + 2, left: rect.left, width: Math.max(rect.width, 160) });
                  }
                }}
              >
                {selectedValues.length > 0 ? (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 2 }}>
                    {selectedValues.map((val) => (
                      <View key={val} style={s.multiSelectChip}>
                        <Text style={s.multiSelectChipText}>{val}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={[s.cellText, s.cellPlaceholder]}>
                    {hasOptions ? "Select..." : "No options configured"}
                  </Text>
                )}
              </TouchableOpacity>
            );
          }

          // Dropdown: click to show portal dropdown
          if (cf.type === "dropdown") {
            const options = selectOptionsBySlot.get(cf.slot) ?? [];
            const hasOptions = options.length > 0;
            const isOpen = customDropdownFor?.memberId === item.groupMemberId && customDropdownFor?.slot === cf.slot;
            return (
              <TouchableOpacity
                style={s.editableCellTouchable}
                data-dropdown="true"
                disabled={!hasOptions}
                onPress={(e) => {
                  if (!hasOptions) return;
                  if (isOpen) {
                    setCustomDropdownFor(null);
                    setDropdownPos(null);
                  } else {
                    const target = (e as any).currentTarget ?? (e as any).target;
                    const rect = target?.getBoundingClientRect?.();
                    if (rect) {
                      setDropdownPos({ top: rect.bottom + 2, left: rect.left, width: Math.max(rect.width, 180) });
                    }
                    setCustomDropdownFor({ memberId: item.groupMemberId, slot: cf.slot });
                    setAssigneeDropdownFor(null);
                    setStatusDropdownFor(null);
                  }
                }}
              >
                <Text style={[s.cellText, !rawValue && s.cellPlaceholder]}>
                  {rawValue || (hasOptions ? "Select..." : "No options configured")}
                </Text>
              </TouchableOpacity>
            );
          }

          // Number: inline input
          if (cf.type === "number") {
            if (editingInlineField === `${item.groupMemberId}:${cf.slot}`) {
              return (
                <TextInput
                  style={s.inlineInput}
                  value={inlineFieldValue}
                  onChangeText={setInlineFieldValue}
                  onBlur={() => {
                    const num = inlineFieldValue.trim() ? Number(inlineFieldValue) : undefined;
                    handleCustomFieldSave(item.groupMemberId, cf.slot, isNaN(num as number) ? undefined : num);
                    setEditingInlineField(null);
                  }}
                  onSubmitEditing={() => {
                    const num = inlineFieldValue.trim() ? Number(inlineFieldValue) : undefined;
                    handleCustomFieldSave(item.groupMemberId, cf.slot, isNaN(num as number) ? undefined : num);
                    setEditingInlineField(null);
                  }}
                  keyboardType="numeric"
                  autoFocus
                  placeholder="0"
                />
              );
            }
            return (
              <TouchableOpacity
                style={s.editableCellTouchable}
                onPress={() => {
                  setEditingInlineField(`${item.groupMemberId}:${cf.slot}`);
                  setInlineFieldValue(rawValue != null ? String(rawValue) : "");
                }}
              >
                <Text style={[s.cellText, rawValue == null && s.cellPlaceholder]}>
                  {rawValue != null ? String(rawValue) : "Click to add"}
                </Text>
              </TouchableOpacity>
            );
          }

          // Text: inline input
          if (editingInlineField === `${item.groupMemberId}:${cf.slot}`) {
            return (
              <TextInput
                style={s.inlineInput}
                value={inlineFieldValue}
                onChangeText={setInlineFieldValue}
                onBlur={() => {
                  handleCustomFieldSave(item.groupMemberId, cf.slot, inlineFieldValue.trim() || undefined);
                  setEditingInlineField(null);
                }}
                onSubmitEditing={() => {
                  handleCustomFieldSave(item.groupMemberId, cf.slot, inlineFieldValue.trim() || undefined);
                  setEditingInlineField(null);
                }}
                autoFocus
                placeholder="Enter..."
              />
            );
          }
          return (
            <TouchableOpacity
              style={s.editableCellTouchable}
              onPress={() => {
                setEditingInlineField(`${item.groupMemberId}:${cf.slot}`);
                setInlineFieldValue(rawValue ?? "");
              }}
            >
              <Text style={[s.cellText, !rawValue && s.cellPlaceholder]}>
                {rawValue || "Click to add"}
              </Text>
            </TouchableOpacity>
          );
        }

        return null;
      }
    }
  };

  // ── Main render ──

  const totalWidth = columns.reduce((sum, col) => sum + getColWidth(col), 0);
  const isSearchLoading = hasTextSearch && searchResults === undefined;
  const effectiveIsLoading = hasTextSearch ? isSearchLoading : isLoading;

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.backButton} onPress={handleBack}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <View style={s.headerContent}>
          <Text style={s.headerTitle}>{toolDisplayName}</Text>
          <Text style={s.headerSubtitle}>{groupData?.name || "Group"}</Text>
        </View>
        <TouchableOpacity
          style={s.addButton}
          onPress={() => {
            setSelectedMemberId(null);
            setShowSettingsPanel(false);
            setShowQuickAddPanel(true);
          }}
        >
          <Ionicons name="person-add-outline" size={16} color="#16A34A" />
          <Text style={s.addButtonText}>Add Person</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.importButton}
          onPress={() => {
            setSelectedMemberId(null);
            setShowSettingsPanel(false);
            setShowQuickAddPanel(false);
            setShowCsvImportModal(true);
          }}
        >
          <Ionicons name="cloud-upload-outline" size={16} color="#2563EB" />
          <Text style={s.importButtonText}>Import CSV</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.settingsButton} onPress={handleSettingsPress}>
          <Ionicons name="settings-outline" size={22} color="#666" />
        </TouchableOpacity>
      </View>

      {/* Search bar */}
      <View style={s.searchBar}>
        <View style={s.searchInputStack}>
          <View style={s.searchInputContainer}>
            <Ionicons name="search" size={16} color="#9CA3AF" />
            <TextInput
              style={s.searchInput}
              placeholder={`Search... (e.g., -assignee:bob, date added:<12/14/25, ${scoreConfig[0]?.name?.toLowerCase() ?? "score"}:>50)`}
              placeholderTextColor="#9CA3AF"
              value={searchQuery}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => setTimeout(() => setIsSearchFocused(false), 120)}
              onChangeText={setSearchQuery}
            />
            {searchQuery !== "" && (
              <TouchableOpacity onPress={() => setSearchQuery("")}>
                <Ionicons name="close-circle" size={16} color="#9CA3AF" />
              </TouchableOpacity>
            )}
          </View>
          {searchHelperText && <Text style={s.searchHelperText}>{searchHelperText}</Text>}
          {showSearchSuggestions && (
            <View style={s.searchSuggestionBox}>
              {searchSuggestions.map((suggestion) => (
                <TouchableOpacity
                  key={suggestion.id}
                  style={s.searchSuggestionRow}
                  onPress={() => {
                    setSearchQuery(applyFollowupSuggestion(searchQuery, suggestion.insertText));
                    setIsSearchFocused(false);
                  }}
                >
                  <Text style={s.searchSuggestionLabel}>{suggestion.label}</Text>
                  <Text style={s.searchSuggestionHelp}>{suggestion.helperText}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
        <Text style={s.memberCount}>
          {hasTextSearch
            ? `${members.length} result${members.length !== 1 ? "s" : ""}`
            : `${totalCount ?? "\u2014"} members${hasAnyFilter ? " (filtered)" : ""}`}
        </Text>
      </View>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <View style={s.actionBar}>
          <View style={s.actionBarLeft}>
            <Text style={s.actionBarCount}>{selectedIds.size} selected</Text>
            <TouchableOpacity onPress={() => setSelectedIds(new Set())}>
              <Text style={s.actionBarDeselect}>Deselect all</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={s.actionBarRemoveButton}
            onPress={() => setShowRemoveModal(true)}
          >
            <Ionicons name="trash-outline" size={14} color="#fff" />
            <Text style={s.actionBarRemoveText}>Remove from group</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Main area: table + side sheet */}
      <View style={s.mainArea}>
        {/* Table */}
        <View style={s.tableContainer}>
          {effectiveIsLoading && members.length === 0 ? (
            <View style={s.loadingContainer}>
              <ActivityIndicator size="large" color={primaryColor} />
              <Text style={s.loadingText}>Loading...</Text>
            </View>
          ) : (
            <ScrollView horizontal style={s.horizontalScroll}>
              <View style={{ width: totalWidth }}>
                {/* Sticky header row */}
                <View style={s.headerRow}>
                  {columns.map((col) => (
                    <View
                      key={col.key}
                      style={[s.headerCell, { width: getColWidth(col) }]}
                    >
                      {col.key === "checkbox" ? (
                        <TouchableOpacity
                          style={s.headerCellInner}
                          onPress={handleSelectAll}
                        >
                          <Ionicons
                            name={
                              members.length > 0 && selectedIds.size === members.length
                                ? "checkbox"
                                : selectedIds.size > 0
                                  ? "remove-outline"
                                  : "square-outline"
                            }
                            size={18}
                            color={selectedIds.size > 0 ? primaryColor : "#9CA3AF"}
                          />
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          style={s.headerCellInner}
                          onPress={() => col.sortable && handleSort(col.key, col.serverSortKey)}
                          disabled={!col.sortable}
                        >
                          <Text
                            style={[
                              s.headerText,
                              (sortField === col.serverSortKey || sortField === col.key) && s.headerTextActive,
                            ]}
                            numberOfLines={1}
                          >
                            {col.label}
                          </Text>
                          {col.sortable && (sortField === col.serverSortKey || sortField === col.key) && (
                            <Ionicons
                              name={sortDirection === "asc" ? "arrow-up" : "arrow-down"}
                              size={12}
                              color={primaryColor}
                            />
                          )}
                        </TouchableOpacity>
                      )}
                      {/* Resize handle */}
                      {col.key !== "checkbox" && (
                        <View
                          style={s.resizeHandle}
                          onStartShouldSetResponder={() => true}
                          {...(Platform.OS === "web"
                            ? { onMouseDown: (e: any) => handleResizeStart(col.key, e) }
                            : {})}
                        />
                      )}
                    </View>
                  ))}
                </View>

                {/* Data rows */}
                <ScrollView
                  style={s.dataScroll}
                  onScroll={(e) => {
                    if (hasTextSearch) return; // No pagination for search results
                    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
                    if (
                      layoutMeasurement.height + contentOffset.y >= contentSize.height - 100 &&
                      paginationStatus === "CanLoadMore"
                    ) {
                      loadMore(50);
                    }
                  }}
                  scrollEventThrottle={200}
                >
                  {members.map((item, rowIndex) => (
                    <TouchableOpacity
                      key={item._id}
                      style={[
                        s.dataRow,
                        selectedIds.has(item.groupMemberId) && s.dataRowChecked,
                        selectedMemberId === item.groupMemberId && s.dataRowSelected,
                        hoveredRowId === item._id && s.dataRowHovered,
                      ]}
                      onPress={(e: any) => {
                        if (e.target?.closest?.("[data-checkbox]")) return;
                        if (e.target?.closest?.("[data-notes]")) return;
                        if (e.target?.closest?.("[data-tasks]")) return;
                        setShowSettingsPanel(false);
                        setShowQuickAddPanel(false);
                        setSelectedMemberId(item.groupMemberId);
                        setScrollToNotes(false);
                        setScrollToTasks(false);
                      }}
                      activeOpacity={0.7}
                      {...(Platform.OS === "web"
                        ? {
                            onMouseEnter: () => setHoveredRowId(item._id),
                            onMouseLeave: () => setHoveredRowId(null),
                          }
                        : {})}
                    >
                      {columns.map((col) => (
                        <View
                          key={col.key}
                          style={[
                            s.dataCell,
                            { width: getColWidth(col) },
                            editableColumns.has(col.key) && s.dataCellEditable,
                          ]}
                        >
                          {renderCellContent(col, item, rowIndex)}
                        </View>
                      ))}
                    </TouchableOpacity>
                  ))}
                  {!hasTextSearch && paginationStatus === "LoadingMore" && (
                    <View style={s.footerLoading}>
                      <ActivityIndicator size="small" color={primaryColor} />
                    </View>
                  )}
                  {members.length === 0 && !effectiveIsLoading && (
                    <View style={s.emptyRow}>
                      <Ionicons name="checkmark-circle-outline" size={32} color="#4CAF50" />
                      <Text style={s.emptyText}>
                        {debouncedSearch ? "No matching members" : "No members found"}
                      </Text>
                    </View>
                  )}
                </ScrollView>
              </View>
            </ScrollView>
          )}
        </View>

        {/* Side sheet — settings panel or member detail (mutually exclusive) */}
        {showSettingsPanel ? (
          <>
            <View style={s.divider} />
            <View style={s.sideSheet}>
              <FollowupSettingsPanel
                groupId={groupId}
                onClose={() => setShowSettingsPanel(false)}
              />
            </View>
          </>
        ) : showQuickAddPanel ? (
          <>
            <View style={s.divider} />
            <View style={s.sideSheet}>
              <FollowupQuickAddPanel
                groupId={groupId}
                customFields={customFields}
                leaderOptions={leaderOptions}
                primaryColor={primaryColor}
                onCancel={() => setShowQuickAddPanel(false)}
                onCreated={({ groupMemberId }) => {
                  setShowQuickAddPanel(false);
                  setSelectedMemberId(groupMemberId);
                  setScrollToNotes(false);
                  setScrollToTasks(false);
                }}
              />
            </View>
          </>
        ) : selectedMemberId ? (
          <>
            <View style={s.divider} />
            <View style={s.sideSheet}>
              <FollowupDetailContent
                groupId={groupId}
                memberId={selectedMemberId}
                onClose={() => setSelectedMemberId(null)}
                scrollToNotes={scrollToNotes}
                scrollToTasks={scrollToTasks}
              />
            </View>
          </>
        ) : null}
      </View>

      {/* Dropdown portal — rendered outside the ScrollView at fixed position */}
      {dropdownPos && assigneeDropdownFor && activeDropdownMember && (
        <View
          style={[
            s.dropdownPortal,
            { top: dropdownPos.top, left: dropdownPos.left, minWidth: dropdownPos.width },
          ]}
          data-dropdown="true"
        >
          {currentUserId && (
            <TouchableOpacity
              style={s.dropdownItem}
              onPress={() => {
                const currentAssigneeIds = getAssigneeIds(activeDropdownMember);
                const nextAssigneeIds = currentAssigneeIds.includes(currentUserId)
                  ? currentAssigneeIds.filter((id) => id !== currentUserId)
                  : [...currentAssigneeIds, currentUserId];
                handleAssigneeSelect(activeDropdownMember.groupMemberId, nextAssigneeIds);
              }}
            >
              <Ionicons
                name={getAssigneeIds(activeDropdownMember).includes(currentUserId) ? "checkbox" : "square-outline"}
                size={16}
                color={primaryColor}
              />
              <Text style={[s.dropdownItemText, { color: primaryColor }]}>Assign to me</Text>
            </TouchableOpacity>
          )}
          <TextInput
            style={s.dropdownSearch}
            placeholder="Search leaders..."
            value={assigneeSearch}
            onChangeText={setAssigneeSearch}
            autoFocus
          />
          <ScrollView style={s.dropdownList} nestedScrollEnabled>
            {filteredLeaders.map((leader: any) => {
              const lid = leader.userId?.toString?.() ?? leader._id?.toString?.() ?? "";
              const isChecked = getAssigneeIds(activeDropdownMember).includes(lid);
              return (
                <TouchableOpacity
                  key={lid}
                  style={s.dropdownItem}
                  onPress={() => {
                    const currentAssigneeIds = getAssigneeIds(activeDropdownMember);
                    const nextAssigneeIds = isChecked
                      ? currentAssigneeIds.filter((id) => id !== lid)
                      : [...currentAssigneeIds, lid];
                    handleAssigneeSelect(activeDropdownMember.groupMemberId, nextAssigneeIds);
                  }}
                >
                  <Ionicons
                    name={isChecked ? "checkbox" : "square-outline"}
                    size={16}
                    color={isChecked ? primaryColor : "#9CA3AF"}
                  />
                  <Avatar
                    name={`${leader.firstName ?? ""} ${leader.lastName ?? ""}`}
                    imageUrl={leader.profilePhoto}
                    size={24}
                  />
                  <Text style={s.dropdownItemText}>
                    {leader.firstName} {leader.lastName}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {getAssigneeIds(activeDropdownMember).length > 0 && (
            <TouchableOpacity
              style={[s.dropdownItem, s.dropdownItemDanger]}
              onPress={() => handleAssigneeSelect(activeDropdownMember.groupMemberId, [])}
            >
              <Text style={[s.dropdownItemText, { color: "#FF3B30" }]}>Clear all assignees</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {dropdownPos && statusDropdownFor && activeDropdownMember && (
        <View
          style={[
            s.dropdownPortal,
            { top: dropdownPos.top, left: dropdownPos.left, minWidth: dropdownPos.width },
          ]}
          data-dropdown="true"
        >
          {STATUS_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.label}
              style={[s.dropdownItem, { backgroundColor: opt.color }]}
              onPress={() => handleStatusSelect(activeDropdownMember.groupMemberId, opt.value)}
            >
              <Text style={s.dropdownItemText}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Custom field dropdown portal */}
      {dropdownPos && customDropdownFor && (() => {
        const cf = customFields.find((f) => f.slot === customDropdownFor.slot);
        const member = displayMembers.find((m) => m.groupMemberId === customDropdownFor.memberId);
        if (!cf || !member) return null;

        if (cf.type === "multiselect") {
          const options = selectOptionsBySlot.get(cf.slot) ?? [];
          const hasOptions = options.length > 0;
          const optState = optimistic[member.groupMemberId] as Record<string, any> | undefined;
          const currentValue = String(
            optState?.[cf.slot] !== undefined
              ? (optState[cf.slot] ?? "")
              : ((member as any)[cf.slot] ?? "")
          );
          const selectedValues = parseMultiSelectValues(currentValue);

          return (
            <View
              style={[
                s.dropdownPortal,
                { top: dropdownPos.top, left: dropdownPos.left, minWidth: dropdownPos.width },
              ]}
              data-dropdown="true"
            >
              {hasOptions ? (
                options.map((opt) => {
                  const isChecked = selectedValues.includes(opt);
                  return (
                    <TouchableOpacity
                      key={opt}
                      style={[s.dropdownItem, isChecked && { backgroundColor: "#F3F4F6" }]}
                      onPress={() => handleMultiSelectToggle(member.groupMemberId, cf.slot, currentValue, opt)}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Ionicons
                          name={isChecked ? "checkbox" : "square-outline"}
                          size={16}
                          color={isChecked ? "#6B21A8" : "#9CA3AF"}
                        />
                        <Text style={s.dropdownItemText}>{opt}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })
              ) : (
                <View style={s.dropdownItem}>
                  <Text style={s.dropdownItemText}>No options configured</Text>
                </View>
              )}
              {selectedValues.length > 0 && (
                <TouchableOpacity
                  style={[s.dropdownItem, s.dropdownItemDanger]}
                  onPress={() => {
                    handleCustomFieldSave(member.groupMemberId, cf.slot, undefined);
                  }}
                >
                  <Text style={[s.dropdownItemText, { color: "#FF3B30" }]}>Clear all</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        }

        if (cf.type === "dropdown") {
          const options = selectOptionsBySlot.get(cf.slot) ?? [];
          const hasOptions = options.length > 0;
          const optState = optimistic[member.groupMemberId] as Record<string, any> | undefined;
          const currentValue = String(
            optState?.[cf.slot] !== undefined
              ? (optState[cf.slot] ?? "")
              : ((member as any)[cf.slot] ?? "")
          );
          return (
            <View
              style={[
                s.dropdownPortal,
                { top: dropdownPos.top, left: dropdownPos.left, minWidth: dropdownPos.width },
              ]}
              data-dropdown="true"
            >
              {hasOptions ? (
                options.map((opt) => (
                  <TouchableOpacity
                    key={opt}
                    style={s.dropdownItem}
                    onPress={() => handleCustomFieldSave(member.groupMemberId, cf.slot, opt)}
                  >
                    <Text style={s.dropdownItemText}>{opt}</Text>
                  </TouchableOpacity>
                ))
              ) : (
                <View style={s.dropdownItem}>
                  <Text style={s.dropdownItemText}>No options configured</Text>
                </View>
              )}
              {currentValue && (
                <TouchableOpacity
                  style={[s.dropdownItem, s.dropdownItemDanger]}
                  onPress={() => handleCustomFieldSave(member.groupMemberId, cf.slot, undefined)}
                >
                  <Text style={[s.dropdownItemText, { color: "#FF3B30" }]}>Clear</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        }

        if (!cf.options) return null;

        return (
          <View
            style={[
              s.dropdownPortal,
              { top: dropdownPos.top, left: dropdownPos.left, minWidth: dropdownPos.width },
            ]}
            data-dropdown="true"
          >
            {cf.options.map((opt) => (
              <TouchableOpacity
                key={opt}
                style={s.dropdownItem}
                onPress={() => handleCustomFieldSave(member.groupMemberId, cf.slot, opt)}
              >
                <Text style={s.dropdownItemText}>{opt}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[s.dropdownItem, s.dropdownItemDanger]}
              onPress={() => handleCustomFieldSave(member.groupMemberId, cf.slot, undefined)}
            >
              <Text style={[s.dropdownItemText, { color: "#FF3B30" }]}>Clear</Text>
            </TouchableOpacity>
          </View>
        );
      })()}

      {/* Bulk remove confirmation modal */}
      <ConfirmModal
        visible={showRemoveModal}
        title={`Remove ${selectedIds.size} member${selectedIds.size !== 1 ? "s" : ""}?`}
        message={
          groupData?.isAnnouncementGroup
            ? `This is the announcements group. Removing ${selectedIds.size} member${selectedIds.size !== 1 ? "s" : ""} will remove them from the entire community, including all groups.`
            : `Are you sure you want to remove ${selectedIds.size} member${selectedIds.size !== 1 ? "s" : ""} from this group?`
        }
        onConfirm={handleBulkRemove}
        onCancel={() => setShowRemoveModal(false)}
        confirmText="Remove"
        isLoading={isRemoving}
        destructive
      />

      <FollowupCsvImportModal
        visible={showCsvImportModal}
        groupId={groupId}
        onClose={() => setShowCsvImportModal(false)}
        onImported={() => {
          setShowCsvImportModal(false);
          setSelectedIds(new Set());
        }}
      />
    </View>
  );
}

// ============================================================================
// Styles
// ============================================================================

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
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
    fontWeight: "bold" as const,
    color: "#333",
  },
  headerSubtitle: {
    fontSize: 14,
    color: "#666",
    marginTop: 2,
  },
  settingsButton: {
    padding: 6,
  },
  importButton: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    borderWidth: 1,
    borderColor: "#BFDBFE",
    backgroundColor: "#EFF6FF",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginRight: 8,
  },
  importButtonText: {
    fontSize: 12,
    fontWeight: "600" as const,
    color: "#2563EB",
  },
  addButton: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    borderWidth: 1,
    borderColor: "#BBF7D0",
    backgroundColor: "#F0FDF4",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginRight: 8,
  },
  addButtonText: {
    fontSize: 12,
    fontWeight: "600" as const,
    color: "#16A34A",
  },

  // Search bar
  searchBar: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#F9FAFB",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
    gap: 12,
  },
  searchInputContainer: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 8,
  },
  searchInputStack: {
    flex: 1,
    gap: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: "#374151",
    ...(Platform.OS === "web" ? { outlineStyle: "none" as any } : {}),
  },
  memberCount: {
    fontSize: 13,
    color: "#6B7280",
    fontWeight: "500" as const,
    paddingTop: 8,
  },
  searchHelperText: {
    fontSize: 11,
    color: "#6B7280",
  },
  searchSuggestionBox: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 8,
    overflow: "hidden",
  },
  searchSuggestionRow: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  searchSuggestionLabel: {
    fontSize: 12,
    color: "#111827",
    fontWeight: "600" as const,
  },
  searchSuggestionHelp: {
    fontSize: 11,
    color: "#6B7280",
    marginTop: 2,
  },

  mainArea: {
    flex: 1,
    flexDirection: "row" as const,
  },
  tableContainer: {
    flex: 1,
  },
  horizontalScroll: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    paddingVertical: 60,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#666",
  },
  headerRow: {
    flexDirection: "row" as const,
    backgroundColor: "#F9FAFB",
    borderBottomWidth: 2,
    borderBottomColor: "#E5E7EB",
    // Sticky on web
    ...(Platform.OS === "web" ? { position: "sticky" as any, top: 0, zIndex: 10 } : {}),
  },
  headerCell: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    position: "relative" as const,
    borderRightWidth: 1,
    borderRightColor: "#E5E7EB",
  },
  headerCellInner: {
    flex: 1,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 8,
    paddingVertical: 10,
    gap: 4,
  },
  headerText: {
    fontSize: 12,
    fontWeight: "600" as const,
    color: "#6B7280",
    textTransform: "uppercase" as const,
  },
  headerTextActive: {
    color: DEFAULT_PRIMARY_COLOR,
  },
  resizeHandle: {
    width: 6,
    height: "100%" as any,
    ...(Platform.OS === "web" ? { cursor: "col-resize" as any } : {}),
    position: "absolute" as const,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "transparent",
  },
  dataScroll: {
    flex: 1,
  },
  dataRow: {
    flexDirection: "row" as const,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
    minHeight: 44,
  },
  dataRowChecked: {
    backgroundColor: "#EFF6FF",
  },
  dataRowSelected: {
    backgroundColor: "#EBF5FF",
  },
  dataRowHovered: {
    backgroundColor: "#F9FAFB",
  },
  dataCell: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    justifyContent: "center" as const,
    borderRightWidth: 1,
    borderRightColor: "#F3F4F6",
  },
  dataCellEditable: {
    backgroundColor: "#F0F7FF",
  },
  rowNumText: {
    fontSize: 12,
    color: "#9CA3AF",
    textAlign: "center" as const,
  },
  nameCellRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  cellText: {
    fontSize: 13,
    color: "#374151",
  },
  cellTextSmall: {
    fontSize: 12,
  },
  cellPlaceholder: {
    color: "#9CA3AF",
    fontStyle: "italic" as const,
  },

  // Score cells
  scoreCell: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: "flex-start" as const,
  },
  scoreCellText: {
    fontSize: 13,
    fontWeight: "600" as const,
  },

  // Status text
  statusText: {
    fontSize: 13,
    fontWeight: "500" as const,
  },

  // Assignee badge
  assigneeBadge: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    backgroundColor: "#E0E7FF",
    borderRadius: 12,
    paddingLeft: 2,
    paddingRight: 8,
    paddingVertical: 2,
    alignSelf: "flex-start" as const,
    gap: 4,
  },
  assigneeBadgeText: {
    fontSize: 12,
    color: "#4338CA",
    fontWeight: "500" as const,
  },
  assigneeBadgesRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    flexWrap: "wrap" as const,
  },
  assigneeMoreText: {
    fontSize: 11,
    color: "#6B7280",
    fontWeight: "600" as const,
  },

  // Notes cell
  notesCell: {
    flex: 1,
  },

  // Tasks cell
  tasksCell: {
    flex: 1,
    gap: 4,
  },
  taskChip: {
    backgroundColor: "#EEF2FF",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  taskChipText: {
    fontSize: 12,
    color: "#4338CA",
    fontWeight: "500" as const,
  },
  taskOverflowText: {
    fontSize: 11,
    color: "#6366F1",
    fontWeight: "500" as const,
    marginTop: 2,
  },

  // Editable cell touchable — full cell hitbox
  editableCellTouchable: {
    flex: 1,
    justifyContent: "center" as const,
    minHeight: 32,
  },
  inlineInput: {
    fontSize: 13,
    color: "#374151",
    borderWidth: 1,
    borderColor: DEFAULT_PRIMARY_COLOR,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    backgroundColor: "#fff",
  },

  // Multiselect chips
  multiSelectChip: {
    backgroundColor: "#EDE9FE",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  multiSelectChipText: {
    fontSize: 11,
    color: "#6B21A8",
  },

  // Alerts
  alertsCell: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 4,
  },
  alertChip: {
    backgroundColor: "#FEF3C7",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  alertChipText: {
    fontSize: 11,
    color: "#B45309",
    fontWeight: "500" as const,
  },

  // Dropdown portal — rendered at fixed position outside ScrollView
  dropdownPortal: {
    position: Platform.OS === "web" ? ("fixed" as any) : ("absolute" as const),
    minWidth: 200,
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 9999,
    padding: 4,
  },
  dropdownSearch: {
    fontSize: 13,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginHorizontal: 4,
    marginBottom: 4,
  },
  dropdownList: {
    maxHeight: 200,
  },
  dropdownItem: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
  },
  dropdownItemDanger: {
    borderTopWidth: 1,
    borderTopColor: "#F3F4F6",
    marginTop: 4,
  },
  dropdownItemText: {
    fontSize: 13,
    color: "#374151",
  },

  // Side sheet
  divider: {
    width: 1,
    backgroundColor: "#E5E5E5",
  },
  sideSheet: {
    width: 420,
    backgroundColor: "#fff",
  },

  // Footer
  footerLoading: {
    paddingVertical: 20,
    alignItems: "center" as const,
  },
  emptyRow: {
    paddingVertical: 40,
    alignItems: "center" as const,
    gap: 8,
  },
  emptyText: {
    fontSize: 14,
    color: "#666",
  },

  // Checkbox
  checkboxTouchable: {
    flex: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    minHeight: 32,
  },

  // Action bar
  actionBar: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#EBF5FF",
    borderBottomWidth: 1,
    borderBottomColor: "#BFDBFE",
  },
  actionBarLeft: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
  },
  actionBarCount: {
    fontSize: 13,
    fontWeight: "600" as const,
    color: "#1E40AF",
  },
  actionBarDeselect: {
    fontSize: 13,
    color: "#2563EB",
    textDecorationLine: "underline" as const,
  },
  actionBarRemoveButton: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    backgroundColor: "#DC2626",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  actionBarRemoveText: {
    fontSize: 13,
    fontWeight: "600" as const,
    color: "#fff",
  },
});
