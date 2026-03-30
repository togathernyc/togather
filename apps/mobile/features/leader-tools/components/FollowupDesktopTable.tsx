import React, {
  useState,
  useMemo,
  useEffect,
  useCallback,
  useRef,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  TextInput,
  ActivityIndicator,
  Platform,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  useQuery,
  useAuthenticatedQuery,
  useAuthenticatedPaginatedQuery,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
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
import { FollowupMapView, FOLLOWUP_MAP_VIEW_ID } from "./FollowupMapView";
import type { CustomFieldDef } from "./ColumnPickerModal";
import {
  SYSTEM_SCORE_COLUMNS,
  getSystemScoreValue,
  adaptCommunityPerson,
  applyDevZipCodeSample,
} from "./followupShared";
import { PeopleViewBar } from "./PeopleViewBar";
import { SaveViewModal } from "./SaveViewModal";
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
import { useTheme } from "@hooks/useTheme";
import type { ThemeColors } from "@/theme/colors";
import { ScoreBreakdownModal, type ScoreBreakdownData } from "./ScoreBreakdownModal";

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
  score3: "score3",
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
  zipCode: "zipCode",
};

type ColumnDef = {
  key: string;
  label: string;
  defaultWidth: number;
  sortable: boolean;
  serverSortKey?: string;
};

// Built-in editable columns that get a visual highlight
const BUILTIN_EDITABLE_COLUMNS = new Set(["assignee", "status", "zipCode"]);

type DropdownPosition = {
  top: number;
  left: number;
  width: number;
};

// ============================================================================
// Helpers
// ============================================================================

function getScoreColor(value: number, colors: ThemeColors): string {
  if (value >= 70) return colors.success;
  if (value >= 40) return colors.warning;
  return colors.destructive;
}

function getScoreBgColor(value: number, colors: ThemeColors): string {
  if (value >= 70) return colors.surfaceSecondary;
  if (value >= 40) return colors.surfaceSecondary;
  return colors.surfaceSecondary;
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

function getStatusColor(status: string | undefined, colors: ThemeColors): { bg: string; text: string } {
  switch (status) {
    case "green":
      return { bg: colors.surfaceSecondary, text: colors.success };
    case "orange":
      return { bg: colors.surfaceSecondary, text: colors.warning };
    case "red":
      return { bg: colors.surfaceSecondary, text: colors.destructive };
    default:
      return { bg: "transparent", text: colors.textSecondary };
  }
}

function getStatusOptions(colors: ThemeColors) {
  return [
    { value: "green" as const, label: "Green", color: colors.surfaceSecondary },
    { value: "orange" as const, label: "Orange", color: colors.surfaceSecondary },
    { value: "red" as const, label: "Red", color: colors.surfaceSecondary },
    { value: undefined, label: "Clear", color: "transparent" },
  ];
}

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

export function FollowupDesktopTable({
  groupId,
  enforcedAssigneeUserId,
  returnTo,
}: {
  groupId: string;
  enforcedAssigneeUserId?: string;
  returnTo?: string | null;
}) {
  const { colors } = useTheme();
  const router = useRouter();
  const { user, community } = useAuth();
  const currentUserId = user?.id as Id<"users"> | undefined;
  const communityId = community?.id as Id<"communities"> | undefined;
  const { primaryColor } = useCommunityTheme();

  // Sort state
  const [sortField, setSortField] = useState<string>("score3");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const debouncedSearch = useDebounce(searchQuery, 300);

  // Side sheet
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [scrollToNotes, setScrollToNotes] = useState(false);
  const [scrollToTasks, setScrollToTasks] = useState(false);

  // Score breakdown modal
  const [scoreBreakdownSheet, setScoreBreakdownSheet] = useState<ScoreBreakdownData | null>(null);

  // Inline editing
  const [editingInlineField, setEditingInlineField] = useState<string | null>(
    null,
  );
  const [inlineFieldValue, setInlineFieldValue] = useState("");

  // Dropdowns — portal-based
  const [assigneeDropdownFor, setAssigneeDropdownFor] = useState<string | null>(
    null,
  );
  const [statusDropdownFor, setStatusDropdownFor] = useState<string | null>(
    null,
  );
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [dropdownPos, setDropdownPos] = useState<DropdownPosition | null>(null);

  // Row hover (web only)
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  // Cell hover for editable cells (web only)
  const [hoveredCellId, setHoveredCellId] = useState<string | null>(null);

  // Optimistic updates — instant UI while mutation round-trips
  const [optimistic, setOptimistic] = useState<
    Record<
      string,
      {
        assigneeIds?: string[] | null;
        status?: string | null;
        [key: string]: any;
      }
    >
  >({});

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  // Settings panel state
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [showQuickAddPanel, setShowQuickAddPanel] = useState(false);
  const [showCsvImportModal, setShowCsvImportModal] = useState(false);

  // PeopleViewBar state
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [showSaveViewModal, setShowSaveViewModal] = useState(false);

  // Delete confirmation state
  const [viewToDelete, setViewToDelete] = useState<{
    id: string;
    name: string;
    isShared: boolean;
  } | null>(null);

  // Column header context menu state (web only)
  const [headerContextMenu, setHeaderContextMenu] = useState<{
    colKey: string;
    colLabel: string;
    top: number;
    left: number;
  } | null>(null);

  // Local column order override (set when view is selected or columns are dragged)
  const [localColumnOrder, setLocalColumnOrder] = useState<string[] | null>(
    null,
  );
  const [localHiddenColumns, setLocalHiddenColumns] = useState<string[] | null>(
    null,
  );

  // Snapshot of column state before opening settings (for revert on close)
  const [preSettingsSnapshot, setPreSettingsSnapshot] = useState<{
    columnOrder: string[] | null;
    hiddenColumns: string[] | null;
  } | null>(null);

  // Drag-to-reorder state (web only)
  const [dragColumnKey, setDragColumnKey] = useState<string | null>(null);
  const [dragOverColumnKey, setDragOverColumnKey] = useState<string | null>(
    null,
  );

  // Custom field dropdown state
  const [customDropdownFor, setCustomDropdownFor] = useState<{
    memberId: string;
    slot: string;
  } | null>(null);

  // Cross-group config query — always fetch so we have community-wide leaders for assignee display
  const crossGroupConfig = useAuthenticatedQuery(
    api.functions.memberFollowups.getCrossGroupConfig,
    {},
  );


  // Config query (per-group)
  const perGroupConfig = useAuthenticatedQuery(
    api.functions.memberFollowups.getFollowupConfig,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip",
  );
  const config = perGroupConfig;

  // Group data for header
  const groupData = useQuery(
    api.functions.groups.index.getById,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip",
  );

  // Community-level data source config
  const communityPeopleConfig = useAuthenticatedQuery(
    api.functions.communityPeople.getConfig,
    groupData?.communityId
      ? { communityId: groupData.communityId }
      : "skip",
  );

  const scoreConfig: ScoreConfigEntry[] =
    communityPeopleConfig?.scores?.map((s: any) => ({
      id: s.id,
      name: s.name,
    })) ?? [];
  const toolDisplayName = perGroupConfig?.toolDisplayName ?? "People";
  // Views are now the only way to persist column preferences.
  // Views are the only way to persist column preferences.
  // No view selected = all columns visible. Local overrides come from view selection or drag-reorder.
  const columnConfig = useMemo(() => {
    if (!localColumnOrder && !localHiddenColumns) return null;
    return {
      columnOrder: localColumnOrder ?? [],
      hiddenColumns: localHiddenColumns ?? [],
    };
  }, [localColumnOrder, localHiddenColumns]);
  const customFields: CustomFieldDef[] =
    (communityPeopleConfig?.customFields ?? []) as CustomFieldDef[];

  // Leaders query (for assignee picker — current group only)
  const perGroupLeaders = useAuthenticatedQuery(
    api.functions.groups.members.getLeaders,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip",
  );
  // Picker options: all community leaders so any leader can be assigned across groups
  const pickerLeaders = crossGroupConfig?.leaders ?? perGroupLeaders;
  // Display: cross-group leaders so assignees from other groups render correctly
  const allLeaders = crossGroupConfig?.leaders ?? perGroupLeaders;

  // Group tasks — used to build per-member task counts for the table
  const groupTasks = useAuthenticatedQuery(
    api.functions.tasks.index.listGroup,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip",
  );

  const tasksByMember = useMemo(() => {
    const map = new Map<
      string,
      Array<{
        _id: string;
        title: string;
        status: string;
        assignedToName?: string;
        groupName?: string;
      }>
    >();
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

  // Assignee display lookup — uses all leaders across groups
  const leaderMap = useMemo(() => {
    if (!allLeaders) return new Map<string, LeaderInfo>();
    return new Map(
      (allLeaders as any[]).map((l: any) => [
        l.userId?.toString?.() ?? l._id?.toString?.() ?? "",
        {
          firstName: l.firstName ?? "",
          lastName: l.lastName ?? "",
          profilePhoto: l.profilePhoto,
        },
      ]),
    );
  }, [allLeaders]);
  // Assignee picker options — current group leaders only
  const leaderOptions = useMemo(() => {
    if (!pickerLeaders)
      return [] as Array<{ id: string; firstName: string; lastName: string }>;
    return (pickerLeaders as any[])
      .map((leader: any) => ({
        id: leader.userId?.toString?.() ?? leader._id?.toString?.() ?? "",
        firstName: leader.firstName ?? "",
        lastName: leader.lastName ?? "",
      }))
      .filter((leader: any) => leader.id.length > 0);
  }, [pickerLeaders]);

  // Parse search query
  const parsedQuery = useMemo(
    () => parseFollowupQuerySyntax(debouncedSearch, leaderMap, scoreConfig, false, currentUserId ?? undefined),
    [debouncedSearch, leaderMap, scoreConfig, currentUserId],
  );
  const saveViewFilters = useMemo(() => {
    const base = {
      statusFilter: parsedQuery.statusFilter,
      assigneeFilter: parsedQuery.assigneeFilter,
      scoreField: parsedQuery.scoreField,
      scoreMin: parsedQuery.scoreMin,
      scoreMax: parsedQuery.scoreMax,
    };
    if (!groupId) {
      return base;
    }
    return { ...base, groupId: groupId as Id<"groups"> };
  }, [groupId, parsedQuery]);
  const hasTextSearch = !!parsedQuery.searchText;
  const hasAnyFilter =
    !!parsedQuery.statusFilter ||
    !!parsedQuery.assigneeFilter ||
    parsedQuery.scoreMin !== undefined ||
    parsedQuery.scoreMax !== undefined ||
    parsedQuery.excludedAssigneeFilters.length > 0 ||
    !!parsedQuery.dateAddedFilter;
  const searchSuggestions = useMemo(
    () => getFollowupSearchSuggestions(searchQuery, scoreConfig),
    [searchQuery, scoreConfig],
  );
  const searchHelperText = useMemo(
    () => getFollowupQueryHelperText(searchQuery, scoreConfig),
    [searchQuery, scoreConfig],
  );
  const showSearchSuggestions =
    isSearchFocused &&
    searchQuery.trim().length > 0 &&
    searchSuggestions.length > 0;

  // Build columns dynamically based on score config + column config
  const columns: ColumnDef[] = useMemo(() => {
    // System columns (always first, not configurable)
    const systemCols: ColumnDef[] = [
      { key: "checkbox", label: "", defaultWidth: 40, sortable: false },
      { key: "rowNum", label: "#", defaultWidth: 44, sortable: false },
    ];

    // All available non-system columns (built-in + score + custom)
    const allAvailable: ColumnDef[] = [];

    allAvailable.push(
      {
        key: "addedAt",
        label: "Date Added",
        defaultWidth: 100,
        sortable: true,
        serverSortKey: "addedAt",
      },
      {
        key: "firstName",
        label: "First Name",
        defaultWidth: 150,
        sortable: true,
        serverSortKey: "firstName",
      },
      {
        key: "lastName",
        label: "Last Name",
        defaultWidth: 120,
        sortable: true,
        serverSortKey: "lastName",
      },
      { key: "email", label: "Email", defaultWidth: 180, sortable: false },
      { key: "phone", label: "Phone", defaultWidth: 140, sortable: false },
      {
        key: "zipCode",
        label: "ZIP Code",
        defaultWidth: 100,
        sortable: true,
        serverSortKey: "zipCode",
      },
      {
        key: "dateOfBirth",
        label: "Birthday",
        defaultWidth: 110,
        sortable: false,
      },
    );

    // Score columns — use fixed SYSTEM_SCORE_COLUMNS.
    // score1 and score2 have server-side indexes; score3+ use client-side sorting.
    SYSTEM_SCORE_COLUMNS.forEach((sc) => {
      allAvailable.push({
        key: sc.slot,
        label: sc.name,
        defaultWidth: 100,
        sortable: true,
        serverSortKey: sc.slot in SERVER_SORT_KEYS
          ? sc.slot
          : undefined,
      });
    });

    allAvailable.push(
      {
        key: "assignee",
        label: "Assignees",
        defaultWidth: 140,
        sortable: true,
        serverSortKey: "assignee",
      },
      { key: "notes", label: "Notes", defaultWidth: 200, sortable: false },
      { key: "tasks", label: "Tasks", defaultWidth: 220, sortable: false },
      {
        key: "status",
        label: "Status",
        defaultWidth: 100,
        sortable: true,
        serverSortKey: "status",
      },
      {
        key: "lastAttendedAt",
        label: "Last Attended",
        defaultWidth: 120,
        sortable: true,
        serverSortKey: "lastAttendedAt",
      },
      {
        key: "lastFollowupAt",
        label: "Last Contact",
        defaultWidth: 120,
        sortable: true,
        serverSortKey: "lastFollowupAt",
      },
      {
        key: "lastActiveAt",
        label: "Date Active",
        defaultWidth: 120,
        sortable: true,
        serverSortKey: "lastActiveAt",
      },
      { key: "alerts", label: "Alerts", defaultWidth: 120, sortable: false },
    );

    // Custom field columns
    for (const cf of customFields) {
      const sortKey =
        cf.slot in SERVER_SORT_KEYS ? SERVER_SORT_KEYS[cf.slot] : undefined;
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

  // Column label map — maps column keys to display labels (same labels as table header)
  // Used by FollowupSettingsPanel for consistent naming
  const columnLabelMap = useMemo(() => {
    const map: Record<string, string> = {};
    map["addedAt"] = "Date Added";
    map["firstName"] = "First Name";
    map["lastName"] = "Last Name";
    map["email"] = "Email";
    map["phone"] = "Phone";
    map["zipCode"] = "ZIP Code";
    map["dateOfBirth"] = "Birthday";
    SYSTEM_SCORE_COLUMNS.forEach((sc) => {
      map[sc.slot] = sc.name;
    });
    map["assignee"] = "Assignees";
    map["notes"] = "Notes";
    map["tasks"] = "Tasks";
    map["status"] = "Status";
    map["lastAttendedAt"] = "Last Attended";
    map["lastFollowupAt"] = "Last Contact";
    map["lastActiveAt"] = "Date Active";
    map["alerts"] = "Alerts";
    for (const cf of customFields) {
      map[cf.slot] = cf.name;
    }
    return map;
  }, [customFields]);

  // All non-system column keys (for passing to settings when no saved config exists)
  const allColumnKeys = useMemo(() => {
    const keys: string[] = [];
    keys.push(
      "addedAt",
      "firstName",
      "lastName",
      "email",
      "phone",
      "zipCode",
      "dateOfBirth",
    );
    SYSTEM_SCORE_COLUMNS.forEach((sc) => keys.push(sc.slot));
    keys.push(
      "assignee",
      "notes",
      "tasks",
      "status",
      "lastAttendedAt",
      "lastFollowupAt",
      "lastActiveAt",
      "alerts",
    );
    for (const cf of customFields) keys.push(cf.slot);
    return keys;
  }, [customFields]);

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
  const colWidthsKey = STORAGE_PREFIX + groupId;
  useEffect(() => {
    if (Platform.OS !== "web") return;
    try {
      const stored = localStorage.getItem(colWidthsKey);
      if (stored) setColWidths(JSON.parse(stored));
    } catch {
      /* localStorage unavailable */
    }
  }, [colWidthsKey]);

  // Save to localStorage
  const saveColWidths = useCallback(
    (widths: Record<string, number>) => {
      if (Platform.OS !== "web") return;
      try {
        localStorage.setItem(colWidthsKey, JSON.stringify(widths));
      } catch {
        /* localStorage unavailable */
      }
    },
    [colWidthsKey],
  );

  const getColWidth = (col: ColumnDef) =>
    colWidths[col.key] ?? col.defaultWidth;

  const serverSortBy = useMemo(() => {
    if (sortField in SERVER_SORT_KEYS) return SERVER_SORT_KEYS[sortField];
    return sortField;
  }, [sortField]);

  // Build filter args for list query (structured filters only, no text search)
  // Note: communityPeople.list only supports statusFilter, scoreField, scoreMin, scoreMax, assigneeFilter.
  // excludedAssigneeFilters and date range filters are applied client-side via applyParsedFollowupFilters.
  // Effective assignee filter: enforced prop takes priority over search syntax
  const effectiveAssigneeFilter = enforcedAssigneeUserId
    ? (enforcedAssigneeUserId as Id<"users">)
    : parsedQuery.assigneeFilter
      ? (parsedQuery.assigneeFilter as Id<"users">)
      : undefined;

  const listFilterArgs = useMemo(() => {
    const args: any = {};
    if (parsedQuery.statusFilter) args.statusFilter = parsedQuery.statusFilter;
    if (effectiveAssigneeFilter)
      args.assigneeFilter = effectiveAssigneeFilter;
    if (enforcedAssigneeUserId)
      args.requireSelfAssignee = true;
    if (parsedQuery.scoreField) args.scoreField = parsedQuery.scoreField;
    if (parsedQuery.scoreMax !== undefined)
      args.scoreMax = parsedQuery.scoreMax;
    if (parsedQuery.scoreMin !== undefined)
      args.scoreMin = parsedQuery.scoreMin;
    return args;
  }, [parsedQuery, effectiveAssigneeFilter, enforcedAssigneeUserId]);

  // Paginated query — used when there's NO text search
  const {
    results: rawMembers,
    status: paginationStatus,
    loadMore,
    isLoading,
  } = useAuthenticatedPaginatedQuery(
    api.functions.communityPeople.list,
    !hasTextSearch && groupId
      ? {
          groupId: groupId as Id<"groups">,
          sortBy:
            activeViewId === FOLLOWUP_MAP_VIEW_ID ? "zipCode" : serverSortBy,
          sortDirection:
            activeViewId === FOLLOWUP_MAP_VIEW_ID ? "desc" : sortDirection,
          ...listFilterArgs,
        }
      : "skip",
    { initialNumItems: 50 },
  );

  // Text search query — used when there IS text search
  const searchResults = useAuthenticatedQuery(
    api.functions.communityPeople.search,
    hasTextSearch && groupId
      ? {
          groupId: groupId as Id<"groups">,
          searchTerm: parsedQuery.searchText,
          ...(parsedQuery.statusFilter
            ? { statusFilter: parsedQuery.statusFilter }
            : {}),
          ...(effectiveAssigneeFilter
            ? { assigneeFilter: effectiveAssigneeFilter }
            : {}),
          ...(enforcedAssigneeUserId
            ? { requireSelfAssignee: true as const }
            : {}),
          ...(parsedQuery.excludedAssigneeFilters.length > 0
            ? {
                excludedAssigneeFilters:
                  parsedQuery.excludedAssigneeFilters as Id<"users">[],
              }
            : {}),
          ...(parsedQuery.scoreField
            ? { scoreField: parsedQuery.scoreField }
            : {}),
          ...(parsedQuery.scoreMax !== undefined
            ? { scoreMax: parsedQuery.scoreMax }
            : {}),
          ...(parsedQuery.scoreMin !== undefined
            ? { scoreMin: parsedQuery.scoreMin }
            : {}),
          ...getDateAddedRangeArgs(parsedQuery.dateAddedFilter),
        }
      : "skip",
  );

  // Total member count
  const totalCount = useAuthenticatedQuery(
    api.functions.communityPeople.count,
    groupId
      ? { groupId: groupId as Id<"groups"> }
      : "skip",
  );

  // Merge: use search results when text search active, otherwise paginated.
  // Apply client-side sorting for score3+ (no server index).
  // Map community people records through adaptCommunityPerson for per-group mode.
  const members = useMemo(() => {
    const raw = (hasTextSearch
      ? (searchResults ?? [])
      : (rawMembers ?? [])) as unknown as any[];
    // Adapt community people records to FollowupMember shape (both modes use communityPeople)
    const adapted: FollowupMember[] = applyDevZipCodeSample(
      raw.map((r: any) => adaptCommunityPerson(r)),
    );
    const filtered = applyParsedFollowupFilters(adapted, parsedQuery);

    return filtered;
  }, [
    hasTextSearch,
    searchResults,
    rawMembers,
    parsedQuery,
  ]);

  // Merge optimistic overrides for consistent UI display
  const getAssigneeIds = useCallback(
    (member: { assigneeId?: string; assigneeIds?: string[] }) => {
      const ids =
        member.assigneeIds && member.assigneeIds.length > 0
          ? member.assigneeIds
          : member.assigneeId
            ? [member.assigneeId]
            : [];
      return Array.from(new Set(ids));
    },
    [],
  );

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
      if ((opt as any).zipCode !== undefined)
        overrides.zipCode = (opt as any).zipCode ?? undefined;
      for (const [key, val] of Object.entries(opt)) {
        if (key.startsWith("custom")) overrides[key] = val ?? undefined;
      }
      return { ...member, ...overrides };
    });
  }, [members, optimistic]);

  const selectOptionsBySlot = useMemo(
    () =>
      buildSelectOptionsBySlot(
        customFields,
        displayMembers as unknown as Record<string, unknown>[],
      ),
    [customFields, displayMembers],
  );

  // Clear optimistic overrides once server data catches up
  useEffect(() => {
    if (Object.keys(optimistic).length === 0) return;
    const memberMap = new Map(members.map((m) => [m.groupMemberId, m]));
    const next: typeof optimistic = {};
    let changed = false;
    for (const [id, overrides] of Object.entries(optimistic)) {
      const server = memberMap.get(id);
      if (!server) {
        next[id] = overrides;
        continue;
      }
      const remaining: typeof overrides = {};
      for (const [key, val] of Object.entries(overrides)) {
        if (key === "assigneeIds") {
          const serverAssigneeIds = getAssigneeIds(server);
          const overrideAssigneeIds = val ?? [];
          const sameAssignees =
            JSON.stringify(serverAssigneeIds) ===
            JSON.stringify(overrideAssigneeIds);
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
  const setAssigneeMut = useAuthenticatedMutation(
    api.functions.communityPeople.setAssignees,
  );
  const setStatusMut = useAuthenticatedMutation(
    api.functions.communityPeople.setStatus,
  );
  // Custom field mutation
  const setCustomFieldMut = useAuthenticatedMutation(
    api.functions.communityPeople.setCustomField,
  );
  // Zip code mutation
  const setZipCodeMut = useAuthenticatedMutation(
    api.functions.communityPeople.setZipCode,
  );
  const assigneeMutationQueueRef = useRef<Record<string, Promise<void>>>({});

  // Bulk remove mutations
  const removeGroupMember = useAuthenticatedMutation(
    api.functions.groupMembers.remove,
  );
  const removeCommunityMember = useAuthenticatedMutation(
    api.functions.communities.removeMember,
  );
  // View delete mutation
  const deleteViewMut = useAuthenticatedMutation(
    api.functions.peopleSavedViews.remove,
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
    if (returnTo) {
      router.push(returnTo as any);
      return;
    }
    if (router.canGoBack()) {
      router.back();
    } else {
      router.push("/(tabs)/profile");
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
    const selectedMembers = members.filter((m) =>
      selectedIds.has(m.groupMemberId),
    );

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
              groupId: getMemberGroupId(m.groupMemberId),
              userId: m.userId as Id<"users">,
            });
          }
        }),
      );

      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;

      if (failed > 0) {
        Alert.alert(
          "Partial Failure",
          `${succeeded} removed successfully, ${failed} failed.`,
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
    // Snapshot current column state before opening settings (for revert on close)
    setPreSettingsSnapshot({
      columnOrder: localColumnOrder,
      hiddenColumns: localHiddenColumns,
    });
    setShowSettingsPanel(true);
    setShowQuickAddPanel(false);
    setSelectedMemberId(null);
  };

  // Helper to resolve groupId for a member
  const getMemberGroupId = useCallback(
    (_memberId: string): Id<"groups"> => groupId as Id<"groups">,
    [groupId],
  );

  const enqueueAssigneeUpdate = useCallback(
    (memberId: string, assigneeIds: string[]) => {
      const previous =
        assigneeMutationQueueRef.current[memberId] ?? Promise.resolve();
      const next = previous
        .catch(() => undefined)
        .then(() => {
          setAssigneeMut({
            communityPeopleId: memberId as any,
            assigneeIds: assigneeIds as any[],
          });
        });
      assigneeMutationQueueRef.current[memberId] = next.finally(() => {
        if (assigneeMutationQueueRef.current[memberId] === next) {
          delete assigneeMutationQueueRef.current[memberId];
        }
      });
      return next;
    },
    [setAssigneeMut],
  );

  const handleAssigneeSelect = async (
    memberId: string,
    assigneeIds: string[],
  ) => {
    const normalizedAssigneeIds = Array.from(new Set(assigneeIds));
    // Optimistic: update UI instantly
    setOptimistic((prev) => {
      return {
        ...prev,
        [memberId]: { ...prev[memberId], assigneeIds: normalizedAssigneeIds },
      };
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
    setOptimistic((prev) => ({
      ...prev,
      [memberId]: { ...prev[memberId], status: status ?? null },
    }));
    setStatusDropdownFor(null);
    setDropdownPos(null);
    try {
      await setStatusMut({
        communityPeopleId: memberId as any,
        status: status || null,
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

  const handleCustomFieldSave = async (
    memberId: string,
    slot: string,
    value: any,
  ) => {
    setOptimistic((prev) => ({
      ...prev,
      [memberId]: { ...prev[memberId], [slot]: value ?? null },
    }));
    setCustomDropdownFor(null);
    setDropdownPos(null);
    try {
      await setCustomFieldMut({
        communityPeopleId: memberId as any,
        field: slot,
        value: value ?? null,
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

  const handleZipCodeSave = async (memberId: string, zipCode: string) => {
    const trimmed = zipCode.trim();
    setOptimistic((prev) => ({
      ...prev,
      [memberId]: { ...prev[memberId], zipCode: trimmed || null },
    }));
    try {
      await setZipCodeMut({
        communityPeopleId: memberId as any,
        zipCode: trimmed || null,
      });
    } catch (err) {
      console.error("[setZipCode] failed:", err);
      setOptimistic((prev) => {
        const next = { ...prev };
        if (next[memberId]) {
          delete (next[memberId] as any).zipCode;
          if (Object.keys(next[memberId]).length === 0) delete next[memberId];
        }
        return next;
      });
    }
  };

  const handleMultiSelectToggle = async (
    memberId: string,
    slot: string,
    rawServerValue: string | undefined | null,
    toggledOption: string,
  ) => {
    // Track values for rollback - set synchronously within setOptimistic
    let previousValue: string | null = null;
    let newValue: string | null = null;

    // Optimistic update WITHOUT closing dropdown
    // Compute value from current optimistic state (via prev) to avoid stale closure issues
    setOptimistic((prev) => {
      const existingOptimistic = (
        prev[memberId] as Record<string, any> | undefined
      )?.[slot];
      const currentValue =
        existingOptimistic !== undefined
          ? String(existingOptimistic ?? "")
          : String(rawServerValue ?? "");

      previousValue = currentValue || null;

      newValue = toggleMultiSelectValue(currentValue, toggledOption) ?? null;
      return { ...prev, [memberId]: { ...prev[memberId], [slot]: newValue } };
    });

    try {
      await setCustomFieldMut({
        communityPeopleId: memberId as any,
        field: slot,
        value: newValue || null,
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
  const openDropdownAtCell = useCallback(
    (e: any, memberId: string, type: "assignee" | "status") => {
      if (Platform.OS !== "web") return;
      setCustomDropdownFor(null); // Close any open custom dropdown
      const target = e.currentTarget ?? e.target;
      const rect = target?.getBoundingClientRect?.();
      if (rect) {
        setDropdownPos({
          top: rect.bottom + 2,
          left: rect.left,
          width: Math.max(rect.width, 200),
        });
      }
      if (type === "assignee") {
        setAssigneeDropdownFor(memberId);
        setStatusDropdownFor(null);
        setAssigneeSearch("");
      } else {
        setStatusDropdownFor(memberId);
        setAssigneeDropdownFor(null);
      }
    },
    [],
  );

  // Column resize handler
  const resizeRef = useRef<{
    key: string;
    startX: number;
    startWidth: number;
  } | null>(null);

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
        const newWidth = Math.max(
          MIN_COL_WIDTH,
          resizeRef.current.startWidth + dx,
        );
        setColWidths((prev) => ({
          ...prev,
          [resizeRef.current!.key]: newWidth,
        }));
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
    [columns, colWidths, saveColWidths],
  );

  // Column drag-to-reorder handlers (web only)
  const handleDragStart = useCallback((colKey: string, e: any) => {
    if (Platform.OS !== "web") return;
    setDragColumnKey(colKey);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", colKey);
  }, []);

  const handleDragOver = useCallback((colKey: string, e: any) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverColumnKey(colKey);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDragColumnKey(null);
    setDragOverColumnKey(null);
  }, []);

  const handleDrop = useCallback(
    (targetKey: string, e: any) => {
      e.preventDefault();
      const sourceKey = dragColumnKey;
      setDragColumnKey(null);
      setDragOverColumnKey(null);
      if (!sourceKey || sourceKey === targetKey) return;

      // Get current non-system column order
      const nonSystemCols = columns.filter(
        (c) => c.key !== "checkbox" && c.key !== "rowNum",
      );
      const currentOrder = nonSystemCols.map((c) => c.key);

      const sourceIdx = currentOrder.indexOf(sourceKey);
      const targetIdx = currentOrder.indexOf(targetKey);
      if (sourceIdx === -1 || targetIdx === -1) return;

      // Move source to target position
      const newOrder = [...currentOrder];
      newOrder.splice(sourceIdx, 1);
      newOrder.splice(targetIdx, 0, sourceKey);

      setLocalColumnOrder(newOrder);
      setActiveViewId(null); // Clear active view since user customized
    },
    [dragColumnKey, columns],
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
    if (!pickerLeaders) return [];
    const search = assigneeSearch.toLowerCase();
    return (pickerLeaders as any[]).filter((l: any) => {
      const name = `${l.firstName ?? ""} ${l.lastName ?? ""}`.toLowerCase();
      return name.includes(search);
    });
  }, [pickerLeaders, assigneeSearch]);

  // Find the member associated with the currently open dropdown (for portal rendering)
  const activeDropdownMember = useMemo(() => {
    const id =
      assigneeDropdownFor ?? statusDropdownFor ?? customDropdownFor?.memberId;
    if (!id) return null;
    return displayMembers.find((m) => m.groupMemberId === id) ?? null;
  }, [
    assigneeDropdownFor,
    statusDropdownFor,
    customDropdownFor,
    displayMembers,
  ]);

  // Cross-group assigned leaders — assigned to this member but not in the current group's picker
  const crossGroupAssignees = useMemo(() => {
    if (!activeDropdownMember) return [];
    const assigneeIds = getAssigneeIds(activeDropdownMember);
    if (assigneeIds.length === 0) return [];
    const pickerIds = new Set(leaderOptions.map((l) => l.id));
    const crossIds = assigneeIds.filter((id) => !pickerIds.has(id));
    if (crossIds.length === 0) return [];

    const allLeadersList = (crossGroupConfig?.leaders ?? []) as any[];
    const groupsList = (crossGroupConfig?.leaderGroups ?? []) as Array<{
      _id: string;
      name: string;
    }>;
    const groupNameMap = new Map(groupsList.map((g) => [g._id, g.name]));
    const currentGroupId = groupId ?? "";

    // Group cross-group assignees by their group
    const byGroup = new Map<
      string,
      Array<{
        userId: string;
        firstName: string;
        lastName: string;
        profilePhoto?: string;
      }>
    >();
    for (const uid of crossIds) {
      const leader = allLeadersList.find(
        (l: any) =>
          (l.userId?.toString?.() ?? l._id?.toString?.() ?? "") === uid,
      );
      if (!leader) continue;
      const leaderGroupIds: string[] = leader.groupIds ?? [];
      // Pick the first group that isn't the current one
      const otherGroupId =
        leaderGroupIds.find((gid: string) => gid !== currentGroupId) ??
        leaderGroupIds[0] ??
        "";
      if (!otherGroupId) continue;
      if (!byGroup.has(otherGroupId)) byGroup.set(otherGroupId, []);
      byGroup.get(otherGroupId)!.push({
        userId: uid,
        firstName: leader.firstName ?? "",
        lastName: leader.lastName ?? "",
        profilePhoto: leader.profilePhoto,
      });
    }

    return Array.from(byGroup.entries()).map(([gid, members]) => ({
      groupId: gid,
      groupName: groupNameMap.get(gid) ?? "Other Group",
      leaders: members,
    }));
  }, [
    activeDropdownMember,
    leaderOptions,
    crossGroupConfig,
    groupId,
    getAssigneeIds,
  ]);

  // ── Render helpers ──

  const renderCellContent = (
    col: ColumnDef,
    rawItem: FollowupMember,
    rowIndex: number,
  ) => {
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
              color={isChecked ? primaryColor : colors.iconSecondary}
            />
          </TouchableOpacity>
        );
      }

      case "rowNum":
        return <Text style={[s.rowNumText, { color: colors.textTertiary }]}>{rowIndex + 1}</Text>;

      case "groupName":
        return (
          <Text style={[s.cellText, { color: colors.text }]} numberOfLines={1}>
            {(item as any).groupName ?? ""}
          </Text>
        );

      case "addedAt":
        return <Text style={[s.cellText, { color: colors.text }]}>{formatShortDate(item.addedAt)}</Text>;

      case "firstName":
        return (
          <View style={s.nameCellRow}>
            <Avatar
              name={`${item.firstName} ${item.lastName ?? ""}`}
              imageUrl={item.avatarUrl}
              size={24}
            />
            <Text style={[s.cellText, { color: colors.text }]}>{item.firstName}</Text>
          </View>
        );

      case "lastName":
        return <Text style={[s.cellText, { color: colors.text }]}>{item.lastName ?? ""}</Text>;

      case "email":
        return (
          <Text style={[s.cellText, s.cellTextSmall, { color: colors.text }]} numberOfLines={1}>
            {item.email ?? ""}
          </Text>
        );

      case "phone":
        return <Text style={[s.cellText, { color: colors.text }]}>{item.phone ?? ""}</Text>;

      case "zipCode": {
        const zipEditKey = `${item.groupMemberId}:zipCode`;
        if (editingInlineField === zipEditKey) {
          return (
            <TextInput
              style={[s.inlineInput, { color: colors.text, borderColor: primaryColor, backgroundColor: colors.background }]}
              value={inlineFieldValue}
              onChangeText={setInlineFieldValue}
              onBlur={() => {
                handleZipCodeSave(
                  item.groupMemberId,
                  inlineFieldValue,
                );
                setEditingInlineField(null);
              }}
              onSubmitEditing={() => {
                handleZipCodeSave(
                  item.groupMemberId,
                  inlineFieldValue,
                );
                setEditingInlineField(null);
              }}
              autoFocus
              placeholder="Enter ZIP..."
            />
          );
        }
        return (
          <TouchableOpacity
            style={s.editableCellTouchable}
            onPress={() => {
              setEditingInlineField(zipEditKey);
              setInlineFieldValue(item.zipCode ?? "");
            }}
          >
            <Text
              style={[s.cellText, { color: colors.text }, !item.zipCode && { color: colors.textTertiary, fontStyle: 'italic' as const }]}
            >
              {item.zipCode || "Click to add"}
            </Text>
          </TouchableOpacity>
        );
      }

      case "dateOfBirth":
        return (
          <Text style={[s.cellText, { color: colors.text }]}>
            {item.dateOfBirth
              ? new Date(item.dateOfBirth).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  timeZone: "UTC",
                })
              : ""}
          </Text>
        );

      case "lastAttendedAt":
        return (
          <Text style={[s.cellText, { color: colors.text }]}>{formatShortDate(item.lastAttendedAt)}</Text>
        );

      case "lastFollowupAt":
        return (
          <Text style={[s.cellText, { color: colors.text }]}>{formatShortDate(item.lastFollowupAt)}</Text>
        );

      case "lastActiveAt":
        return (
          <Text style={[s.cellText, { color: colors.text }]}>{formatShortDate(item.lastActiveAt)}</Text>
        );

      case "alerts":
        return (
          <View style={s.alertsCell}>
            {item.alerts?.map((label, i) => (
              <View key={i} style={[s.alertChip, { backgroundColor: colors.warning }]}>
                <Text style={[s.alertChipText, { color: colors.text }]}>{label}</Text>
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
            <Text style={[s.cellText, { color: colors.text }]} numberOfLines={2}>
              {item.latestNote || ""}
            </Text>
          </TouchableOpacity>
        );

      case "tasks": {
        const tasks = tasksByMember.get(item.userId) ?? [];
        if (tasks.length === 0) {
          return <Text style={[s.cellText, { color: colors.text }]}>{"\u2014"}</Text>;
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
              <View key={task._id} style={[s.taskChip, { backgroundColor: colors.surfaceSecondary }]}>
                <Text style={[s.taskChipText, { color: colors.link }]} numberOfLines={1}>
                  {task.assignedToName ?? "Unassigned"} — {task.title}
                </Text>
              </View>
            ))}
            {overflow > 0 && (
              <Text style={[s.taskOverflowText, { color: colors.link }]}>+{overflow} more</Text>
            )}
          </TouchableOpacity>
        );
      }

      case "assignee": {
        const isOpen = assigneeDropdownFor === item.groupMemberId;
        const assigneeIds = getAssigneeIds(item);
        const assignees = assigneeIds
          .map((assigneeId) => ({
            assigneeId,
            leader: leaderMap.get(assigneeId),
          }))
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
                  <View key={assigneeId} style={[s.assigneeBadge, { backgroundColor: colors.surfaceSecondary }]}>
                    <Avatar
                      name={`${leader!.firstName} ${leader!.lastName}`}
                      imageUrl={leader!.profilePhoto}
                      size={20}
                    />
                    <Text style={[s.assigneeBadgeText, { color: colors.link }]}>{leader!.firstName}</Text>
                  </View>
                ))}
                {assignees.length > 2 && (
                  <Text style={[s.assigneeMoreText, { color: colors.textSecondary }]}>
                    +{assignees.length - 2}
                  </Text>
                )}
              </View>
            ) : (
              <Text style={[s.cellPlaceholder, { color: colors.textTertiary }]}>Assign</Text>
            )}
          </TouchableOpacity>
        );
      }

      case "status": {
        const isOpen = statusDropdownFor === item.groupMemberId;
        const statusStyle = getStatusColor(item.status, colors);
        return (
          <TouchableOpacity
            style={[
              s.editableCellTouchable,
              { backgroundColor: statusStyle.bg, borderRadius: 6 },
            ]}
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
              {item.status
                ? item.status.charAt(0).toUpperCase() + item.status.slice(1)
                : "\u2014"}
            </Text>
          </TouchableOpacity>
        );
      }

      default: {
        // Score columns
        if (col.key.startsWith("score")) {
          const slot = col.key as "score1" | "score2" | "score3";
          const value = getSystemScoreValue(item, slot) ?? 0;
          return (
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={(e: any) => {
                e.stopPropagation?.();
                setScoreBreakdownSheet({
                  memberId: item._id ?? item.groupMemberId ?? "",
                  memberName: `${item.firstName} ${item.lastName}`.trim(),
                  scores: SYSTEM_SCORE_COLUMNS.map((sc) => ({
                    id: sc.id,
                    name: sc.name,
                    slot: sc.slot,
                    value: getSystemScoreValue(item, sc.slot) ?? 0,
                  })),
                });
              }}
              style={[s.scoreCell, { backgroundColor: getScoreBgColor(value, colors) }]}
            >
              <Text style={[s.scoreCellText, { color: getScoreColor(value, colors) }]}>
                {value}%
              </Text>
            </TouchableOpacity>
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
                  color={rawValue ? primaryColor : colors.iconSecondary}
                />
              </TouchableOpacity>
            );
          }

          // Multiselect: click to show portal dropdown with checkboxes
          if (cf.type === "multiselect") {
            const options = selectOptionsBySlot.get(cf.slot) ?? [];
            const hasOptions = options.length > 0;
            const selectedValues = parseMultiSelectValues(
              rawValue ? String(rawValue) : "",
            );
            return (
              <TouchableOpacity
                style={s.editableCellTouchable}
                data-dropdown="true"
                disabled={!hasOptions}
                onPress={(e) => {
                  if (!hasOptions) return;
                  setCustomDropdownFor({
                    memberId: item.groupMemberId,
                    slot: cf.slot,
                  });
                  setAssigneeDropdownFor(null);
                  setStatusDropdownFor(null);
                  const target = (e as any).currentTarget ?? (e as any).target;
                  const rect = target?.getBoundingClientRect?.();
                  if (rect) {
                    setDropdownPos({
                      top: rect.bottom + 2,
                      left: rect.left,
                      width: Math.max(rect.width, 160),
                    });
                  }
                }}
              >
                {selectedValues.length > 0 ? (
                  <View
                    style={{ flexDirection: "row", flexWrap: "wrap", gap: 2 }}
                  >
                    {selectedValues.map((val) => (
                      <View key={val} style={[s.multiSelectChip, { backgroundColor: colors.surfaceSecondary }]}>
                        <Text style={[s.multiSelectChipText, { color: colors.link }]}>{val}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={[s.cellText, { color: colors.textTertiary, fontStyle: 'italic' as const }]}>
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
            const isOpen =
              customDropdownFor?.memberId === item.groupMemberId &&
              customDropdownFor?.slot === cf.slot;
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
                    const target =
                      (e as any).currentTarget ?? (e as any).target;
                    const rect = target?.getBoundingClientRect?.();
                    if (rect) {
                      setDropdownPos({
                        top: rect.bottom + 2,
                        left: rect.left,
                        width: Math.max(rect.width, 180),
                      });
                    }
                    setCustomDropdownFor({
                      memberId: item.groupMemberId,
                      slot: cf.slot,
                    });
                    setAssigneeDropdownFor(null);
                    setStatusDropdownFor(null);
                  }
                }}
              >
                <Text style={[s.cellText, { color: colors.text }, !rawValue && { color: colors.textTertiary, fontStyle: 'italic' as const }]}>
                  {rawValue ||
                    (hasOptions ? "Select..." : "No options configured")}
                </Text>
              </TouchableOpacity>
            );
          }

          // Number: inline input
          if (cf.type === "number") {
            if (editingInlineField === `${item.groupMemberId}:${cf.slot}`) {
              return (
                <TextInput
                  style={[s.inlineInput, { color: colors.text, borderColor: primaryColor, backgroundColor: colors.background }]}
                  value={inlineFieldValue}
                  onChangeText={setInlineFieldValue}
                  onBlur={() => {
                    const num = inlineFieldValue.trim()
                      ? Number(inlineFieldValue)
                      : undefined;
                    handleCustomFieldSave(
                      item.groupMemberId,
                      cf.slot,
                      isNaN(num as number) ? undefined : num,
                    );
                    setEditingInlineField(null);
                  }}
                  onSubmitEditing={() => {
                    const num = inlineFieldValue.trim()
                      ? Number(inlineFieldValue)
                      : undefined;
                    handleCustomFieldSave(
                      item.groupMemberId,
                      cf.slot,
                      isNaN(num as number) ? undefined : num,
                    );
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
                <Text
                  style={[s.cellText, { color: colors.text }, rawValue == null && { color: colors.textTertiary, fontStyle: 'italic' as const }]}
                >
                  {rawValue != null ? String(rawValue) : "Click to add"}
                </Text>
              </TouchableOpacity>
            );
          }

          // Text: inline input
          if (editingInlineField === `${item.groupMemberId}:${cf.slot}`) {
            return (
              <TextInput
                style={[s.inlineInput, { color: colors.text, borderColor: primaryColor, backgroundColor: colors.background }]}
                value={inlineFieldValue}
                onChangeText={setInlineFieldValue}
                onBlur={() => {
                  handleCustomFieldSave(
                    item.groupMemberId,
                    cf.slot,
                    inlineFieldValue.trim() || undefined,
                  );
                  setEditingInlineField(null);
                }}
                onSubmitEditing={() => {
                  handleCustomFieldSave(
                    item.groupMemberId,
                    cf.slot,
                    inlineFieldValue.trim() || undefined,
                  );
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
              <Text style={[s.cellText, { color: colors.text }, !rawValue && { color: colors.textTertiary, fontStyle: 'italic' as const }]}>
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

  // Track whether we've ever loaded data — once true, never show the full-page
  // loading spinner again (prevents horizontal scroll position from resetting
  // when sort/filter changes cause the query to briefly return [])
  const hasEverLoadedRef = useRef(false);
  if (members.length > 0) hasEverLoadedRef.current = true;
  const showInitialLoading = effectiveIsLoading && !hasEverLoadedRef.current;
  const isMapViewActive = activeViewId === FOLLOWUP_MAP_VIEW_ID;

  // Load-all state for map view — fetches all members with ZIP codes via a dedicated query
  const [loadAllMapMembers, setLoadAllMapMembers] = useState(false);

  // Reset load-all state when switching groups to avoid auto-loading for new groups
  useEffect(() => {
    setLoadAllMapMembers(false);
  }, [groupId]);
  const allMapMembersRaw = useAuthenticatedQuery(
    api.functions.communityPeople.listForMap,
    loadAllMapMembers && isMapViewActive && groupId
      ? { groupId: groupId as Id<"groups"> }
      : "skip",
  );
  const allMapMembers = useMemo(() => {
    if (!allMapMembersRaw) return undefined;
    return allMapMembersRaw.map((m: any) => ({
      groupMemberId: m._id,
      firstName: m.firstName,
      lastName: m.lastName,
      avatarUrl: m.avatarUrl,
      zipCode: m.zipCode,
      status: m.status,
    }));
  }, [allMapMembersRaw]);

  // Preserve horizontal scroll position across re-renders (sort/filter changes)
  const horizontalScrollRef = useRef<ScrollView>(null);
  const scrollXRef = useRef(0);
  useEffect(() => {
    if (
      Platform.OS === "web" &&
      horizontalScrollRef.current &&
      scrollXRef.current > 0
    ) {
      // Restore after React re-renders the ScrollView contents
      requestAnimationFrame(() => {
        horizontalScrollRef.current?.scrollTo({
          x: scrollXRef.current,
          animated: false,
        });
      });
    }
  });

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[s.header, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={s.backButton} onPress={handleBack}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={s.headerContent}>
          <Text style={[s.headerTitle, { color: colors.text }]}>{toolDisplayName}</Text>
          <Text style={[s.headerSubtitle, { color: colors.textSecondary }]}>
            {groupData?.name || "Group"}
          </Text>
        </View>
        <TouchableOpacity
          style={[s.addButton, { borderColor: colors.success, backgroundColor: colors.surfaceSecondary }]}
          onPress={() => {
            setSelectedMemberId(null);
            setShowSettingsPanel(false);
            setShowQuickAddPanel(true);
          }}
        >
          <Ionicons name="person-add-outline" size={16} color={colors.success} />
          <Text style={[s.addButtonText, { color: colors.success }]}>Add Person</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.importButton, { borderColor: colors.link, backgroundColor: colors.surfaceSecondary }]}
          onPress={() => {
            setSelectedMemberId(null);
            setShowSettingsPanel(false);
            setShowQuickAddPanel(false);
            setShowCsvImportModal(true);
          }}
        >
          <Ionicons name="cloud-upload-outline" size={16} color={colors.link} />
          <Text style={[s.importButtonText, { color: colors.link }]}>Import CSV</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.settingsButton}
          onPress={handleSettingsPress}
        >
          <Ionicons name="settings-outline" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Search bar */}
      <View style={[s.searchBar, { backgroundColor: colors.surfaceSecondary, borderBottomColor: colors.border }]}>
        <View style={s.searchInputStack}>
          <View style={[s.searchInputContainer, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Ionicons name="search" size={16} color={colors.iconSecondary} />
            <TextInput
              style={[s.searchInput, { color: colors.text }]}
              placeholder={`Search... (e.g., -assignee:bob, date added:<12/14/25, ${scoreConfig[0]?.name?.toLowerCase() ?? "score"}:>50)`}
              placeholderTextColor={colors.iconSecondary}
              value={searchQuery}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => setTimeout(() => setIsSearchFocused(false), 120)}
              onChangeText={setSearchQuery}
            />
            {searchQuery !== "" && (
              <TouchableOpacity onPress={() => setSearchQuery("")}>
                <Ionicons name="close-circle" size={16} color={colors.iconSecondary} />
              </TouchableOpacity>
            )}
          </View>
          {searchHelperText && (
            <Text style={[s.searchHelperText, { color: colors.textSecondary }]}>{searchHelperText}</Text>
          )}
          {showSearchSuggestions && (
            <View style={[s.searchSuggestionBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
              {searchSuggestions.map((suggestion) => (
                <TouchableOpacity
                  key={suggestion.id}
                  style={[s.searchSuggestionRow, { borderBottomColor: colors.borderLight }]}
                  onPress={() => {
                    setSearchQuery(
                      applyFollowupSuggestion(
                        searchQuery,
                        suggestion.insertText,
                      ),
                    );
                    setIsSearchFocused(false);
                  }}
                >
                  <Text style={[s.searchSuggestionLabel, { color: colors.text }]}>
                    {suggestion.label}
                  </Text>
                  <Text style={[s.searchSuggestionHelp, { color: colors.textSecondary }]}>
                    {suggestion.helperText}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
        <Text style={[s.memberCount, { color: colors.textSecondary }]}>
          {hasTextSearch
            ? `${members.length} result${members.length !== 1 ? "s" : ""}`
            : `${totalCount ?? "\u2014"} members${hasAnyFilter ? " (filtered)" : ""}`}
        </Text>
      </View>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && !isMapViewActive && (
        <View style={[s.actionBar, { backgroundColor: colors.selectedBackground, borderBottomColor: colors.link }]}>
          <View style={s.actionBarLeft}>
            <Text style={[s.actionBarCount, { color: colors.link }]}>{selectedIds.size} selected</Text>
            <TouchableOpacity onPress={() => setSelectedIds(new Set())}>
              <Text style={[s.actionBarDeselect, { color: colors.link }]}>Deselect all</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[s.actionBarRemoveButton, { backgroundColor: colors.destructive }]}
            onPress={() => setShowRemoveModal(true)}
          >
            <Ionicons name="trash-outline" size={14} color={colors.textInverse} />
            <Text style={[s.actionBarRemoveText, { color: '#fff' }]}>Remove from group</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* People view bar */}
      {groupData?.communityId && (
        <PeopleViewBar
          communityId={(groupData?.communityId ?? communityId)!}
          activeViewId={activeViewId}
          onViewSelect={(viewId, view) => {
            if (view?.isSpecial) {
              setActiveViewId(viewId);
              return;
            }
            setActiveViewId(viewId);
            // Apply sort
            if (view.sortBy) setSortField(view.sortBy);
            if (view.sortDirection) setSortDirection(view.sortDirection);
            // Apply column order & hidden columns
            setLocalColumnOrder(view.columnOrder ?? null);
            setLocalHiddenColumns(view.hiddenColumns ?? null);
            // Apply filters as search query
            const filterParts: string[] = [];
            if (view.filters?.statusFilter)
              filterParts.push(`status:${view.filters.statusFilter}`);
            if (view.filters?.assigneeFilter) {
              const leader = leaderMap.get(view.filters.assigneeFilter);
              if (leader) filterParts.push(`assignee:${leader.firstName}`);
            }
            if (
              view.filters?.scoreField &&
              view.filters?.scoreMin !== undefined
            ) {
              filterParts.push(
                `${view.filters.scoreField}:>${view.filters.scoreMin}`,
              );
            }
            if (
              view.filters?.scoreField &&
              view.filters?.scoreMax !== undefined
            ) {
              filterParts.push(
                `${view.filters.scoreField}:<${view.filters.scoreMax}`,
              );
            }
            setSearchQuery(filterParts.join(" "));
          }}
          onViewDeselect={() => {
            if (activeViewId === FOLLOWUP_MAP_VIEW_ID) {
              setActiveViewId(null);
              return;
            }
            setActiveViewId(null);
            setLocalColumnOrder(null);
            setLocalHiddenColumns(null);
            setSortField("score3");
            setSortDirection("asc");
            setSearchQuery("");
          }}
          onDeleteView={(viewId, viewName, isShared) => {
            setViewToDelete({ id: viewId, name: viewName, isShared });
          }}
          onCreateView={() => setShowSaveViewModal(true)}
          isAdmin={user?.is_admin === true}
          specialViews={[{ id: FOLLOWUP_MAP_VIEW_ID, name: "Map", icon: "map-outline" }]}
        />
      )}

      {/* Unsaved column changes bar */}
      {!isMapViewActive &&
        (localColumnOrder !== null || localHiddenColumns !== null) &&
        activeViewId === null && (
          <View style={[s.unsavedBar, { backgroundColor: colors.surfaceSecondary, borderBottomColor: colors.border }]}>
            <Text style={[s.unsavedText, { color: colors.textSecondary }]}>Unsaved column changes</Text>
            <TouchableOpacity onPress={() => setShowSaveViewModal(true)}>
              <Text style={[s.unsavedAction, { color: primaryColor }]}>
                Save as View
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setLocalColumnOrder(null);
                setLocalHiddenColumns(null);
              }}
            >
              <Text style={[s.unsavedDiscard, { color: colors.textTertiary }]}>Discard</Text>
            </TouchableOpacity>
          </View>
        )}

      {/* Main area: table + side sheet */}
      <View style={s.mainArea}>
        {/* Table */}
        <View style={s.tableContainer}>
          {isMapViewActive ? (
            <FollowupMapView
              members={displayMembers.map((member) => ({
                groupMemberId: member.groupMemberId,
                firstName: member.firstName,
                lastName: member.lastName,
                avatarUrl: member.avatarUrl,
                zipCode: member.zipCode,
                status: member.status,
                groupName: (member as any).groupName,
              }))}
              loading={showInitialLoading}
              allMembers={allMapMembers}
              onLoadAll={() => setLoadAllMapMembers(true)}
              isLoadingAll={loadAllMapMembers && allMapMembers === undefined}
              onOpenMember={(memberId) => {
                setShowSettingsPanel(false);
                setShowQuickAddPanel(false);
                setSelectedMemberId(memberId);
                setScrollToNotes(false);
                setScrollToTasks(false);
              }}
            />
          ) : showInitialLoading ? (
            <View style={s.loadingContainer}>
              <ActivityIndicator size="large" color={primaryColor} />
              <Text style={[s.loadingText, { color: colors.textSecondary }]}>Loading...</Text>
            </View>
          ) : (
            <ScrollView
              ref={horizontalScrollRef}
              horizontal
              style={s.horizontalScroll}
              scrollEventThrottle={16}
              onScroll={(e) => {
                scrollXRef.current = e.nativeEvent.contentOffset.x;
              }}
            >
              <View style={{ width: totalWidth }}>
                {/* Sticky header row */}
                <View style={[s.headerRow, { backgroundColor: colors.surfaceSecondary, borderBottomColor: colors.border }]}>
                  {columns.map((col) => {
                    const isSystemCol =
                      col.key === "checkbox" || col.key === "rowNum";
                    const isDraggable = Platform.OS === "web" && !isSystemCol;
                    const isDragOver =
                      dragOverColumnKey === col.key &&
                      dragColumnKey !== col.key;

                    const cellStyle = StyleSheet.flatten([
                      s.headerCell,
                      { width: getColWidth(col), borderRightColor: colors.border },
                      dragColumnKey === col.key && { opacity: 0.4 },
                      isDragOver && {
                        borderLeftWidth: 2,
                        borderLeftColor: primaryColor,
                      },
                    ]);

                    const cellChildren = (
                      <>
                        {col.key === "checkbox" ? (
                          <TouchableOpacity
                            style={s.headerCellInner}
                            onPress={handleSelectAll}
                          >
                            <Ionicons
                              name={
                                members.length > 0 &&
                                selectedIds.size === members.length
                                  ? "checkbox"
                                  : selectedIds.size > 0
                                    ? "remove-outline"
                                    : "square-outline"
                              }
                              size={18}
                              color={
                                selectedIds.size > 0 ? primaryColor : colors.iconSecondary
                              }
                            />
                          </TouchableOpacity>
                        ) : (
                          <TouchableOpacity
                            style={[
                              s.headerCellInner,
                              isDraggable && ({ cursor: "grab" } as any),
                            ]}
                            onPress={() =>
                              col.sortable &&
                              handleSort(col.key, col.serverSortKey)
                            }
                            disabled={!col.sortable}
                          >
                            <Text
                              style={[
                                s.headerText,
                                { color: colors.textSecondary },
                                (sortField === col.serverSortKey ||
                                  sortField === col.key) && { color: primaryColor },
                              ]}
                              numberOfLines={1}
                            >
                              {col.label}
                            </Text>
                            {col.sortable &&
                              (sortField === col.serverSortKey ||
                                sortField === col.key) && (
                                <Ionicons
                                  name={
                                    sortDirection === "asc"
                                      ? "arrow-up"
                                      : "arrow-down"
                                  }
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
                              ? {
                                  onMouseDown: (e: any) =>
                                    handleResizeStart(col.key, e),
                                }
                              : {})}
                          />
                        )}
                      </>
                    );

                    // On web, use React.createElement('div') so HTML5 drag attributes work
                    // (RN Web View strips unknown DOM attributes like draggable)
                    if (isDraggable) {
                      return React.createElement(
                        "div",
                        {
                          key: col.key,
                          style: cellStyle,
                          draggable: true,
                          onDragStart: (e: any) => handleDragStart(col.key, e),
                          onDragOver: (e: any) => handleDragOver(col.key, e),
                          onDragEnd: handleDragEnd,
                          onDrop: (e: any) => handleDrop(col.key, e),
                          onContextMenu: (e: any) => {
                            e.preventDefault();
                            setHeaderContextMenu({
                              colKey: col.key,
                              colLabel: col.label,
                              top: e.clientY,
                              left: e.clientX,
                            });
                          },
                        },
                        cellChildren,
                      );
                    }

                    return (
                      <View key={col.key} style={cellStyle}>
                        {cellChildren}
                      </View>
                    );
                  })}
                </View>

                {/* Data rows */}
                <ScrollView
                  style={s.dataScroll}
                  onScroll={(e) => {
                    if (hasTextSearch) return; // No pagination for search results
                    const { layoutMeasurement, contentOffset, contentSize } =
                      e.nativeEvent;
                    if (
                      layoutMeasurement.height + contentOffset.y >=
                        contentSize.height - 100 &&
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
                        { borderBottomColor: colors.borderLight },
                        selectedIds.has(item.groupMemberId) && { backgroundColor: colors.selectedBackground },
                        selectedMemberId === item.groupMemberId && { backgroundColor: colors.selectedBackground },
                        hoveredRowId === item._id && { backgroundColor: colors.surfaceSecondary },
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
                      {columns.map((col) => {
                        const isEditable = editableColumns.has(col.key);
                        const cellId = `${item._id}:${col.key}`;
                        return (
                          <View
                            key={col.key}
                            style={[
                              s.dataCell,
                              { width: getColWidth(col), borderRightColor: colors.borderLight },
                              isEditable && { backgroundColor: colors.surfaceSecondary },
                              isEditable &&
                                hoveredCellId === cellId && { backgroundColor: colors.selectedBackground },
                            ]}
                            {...(Platform.OS === "web" && isEditable
                              ? {
                                  onMouseEnter: () => setHoveredCellId(cellId),
                                  onMouseLeave: () => setHoveredCellId(null),
                                }
                              : {})}
                          >
                            {renderCellContent(col, item, rowIndex)}
                          </View>
                        );
                      })}
                    </TouchableOpacity>
                  ))}
                  {!hasTextSearch && paginationStatus === "LoadingMore" && (
                    <View style={s.footerLoading}>
                      <ActivityIndicator size="small" color={primaryColor} />
                    </View>
                  )}
                  {members.length === 0 && !effectiveIsLoading && (
                    <View style={s.emptyRow}>
                      <Ionicons
                        name="checkmark-circle-outline"
                        size={32}
                        color={colors.success}
                      />
                      <Text style={[s.emptyText, { color: colors.textSecondary }]}>
                        {debouncedSearch
                          ? "No matching members"
                          : "No members found"}
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
            <View style={[s.divider, { backgroundColor: colors.border }]} />
            <View style={[s.sideSheet, { backgroundColor: colors.background }]}>
              <FollowupSettingsPanel
                groupId={groupId}
                communityId={groupData?.communityId ?? communityId}
                isAdmin={user?.is_admin === true}
                currentColumnOrder={
                  localColumnOrder ?? columnConfig?.columnOrder ?? allColumnKeys
                }
                currentHiddenColumns={
                  localHiddenColumns ?? columnConfig?.hiddenColumns ?? []
                }
                columnLabels={columnLabelMap}
                onColumnChange={(order, hidden) => {
                  setLocalColumnOrder(order);
                  setLocalHiddenColumns(hidden);
                }}
                onClose={() => {
                  // Keep column changes made in settings (unsaved changes bar will show)
                  setPreSettingsSnapshot(null);
                  setShowSettingsPanel(false);
                }}
              />
            </View>
          </>
        ) : showQuickAddPanel ? (
          <>
            <View style={[s.divider, { backgroundColor: colors.border }]} />
            <View style={[s.sideSheet, { backgroundColor: colors.background }]}>
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
            <View style={[s.divider, { backgroundColor: colors.border }]} />
            <View style={[s.sideSheet, { backgroundColor: colors.background }]}>
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

      {/* Backdrop to dismiss dropdowns */}
      {dropdownPos &&
        (assigneeDropdownFor || statusDropdownFor || customDropdownFor) && (
          <TouchableOpacity
            style={{
              position: "fixed" as any,
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 9998,
            }}
            activeOpacity={1}
            onPress={() => {
              setAssigneeDropdownFor(null);
              setStatusDropdownFor(null);
              setCustomDropdownFor(null);
              setDropdownPos(null);
            }}
          />
        )}

      {/* Dropdown portal — rendered outside the ScrollView at fixed position */}
      {dropdownPos && assigneeDropdownFor && activeDropdownMember && (
        <View
          style={[
            s.dropdownPortal,
            {
              top: dropdownPos.top,
              left: dropdownPos.left,
              minWidth: dropdownPos.width,
              backgroundColor: colors.background,
              borderColor: colors.border,
            },
          ]}
          data-dropdown="true"
        >
          {currentUserId && (
            <TouchableOpacity
              style={s.dropdownItem}
              onPress={() => {
                const currentAssigneeIds = getAssigneeIds(activeDropdownMember);
                const nextAssigneeIds = currentAssigneeIds.includes(
                  currentUserId,
                )
                  ? currentAssigneeIds.filter((id) => id !== currentUserId)
                  : [...currentAssigneeIds, currentUserId];
                handleAssigneeSelect(
                  activeDropdownMember.groupMemberId,
                  nextAssigneeIds,
                );
              }}
            >
              <Ionicons
                name={
                  getAssigneeIds(activeDropdownMember).includes(currentUserId)
                    ? "checkbox"
                    : "square-outline"
                }
                size={16}
                color={primaryColor}
              />
              <Text style={[s.dropdownItemText, { color: primaryColor }]}>
                Assign to me
              </Text>
            </TouchableOpacity>
          )}
          <TextInput
            style={[s.dropdownSearch, { borderColor: colors.border, color: colors.text }]}
            placeholder="Search leaders..."
            placeholderTextColor={colors.inputPlaceholder}
            value={assigneeSearch}
            onChangeText={setAssigneeSearch}
            autoFocus
          />
          <ScrollView style={s.dropdownList} nestedScrollEnabled>
            {filteredLeaders.map((leader: any) => {
              const lid =
                leader.userId?.toString?.() ?? leader._id?.toString?.() ?? "";
              const isChecked =
                getAssigneeIds(activeDropdownMember).includes(lid);
              return (
                <TouchableOpacity
                  key={lid}
                  style={s.dropdownItem}
                  onPress={() => {
                    const currentAssigneeIds =
                      getAssigneeIds(activeDropdownMember);
                    const nextAssigneeIds = isChecked
                      ? currentAssigneeIds.filter((id) => id !== lid)
                      : [...currentAssigneeIds, lid];
                    handleAssigneeSelect(
                      activeDropdownMember.groupMemberId,
                      nextAssigneeIds,
                    );
                  }}
                >
                  <Ionicons
                    name={isChecked ? "checkbox" : "square-outline"}
                    size={16}
                    color={isChecked ? primaryColor : colors.iconSecondary}
                  />
                  <Avatar
                    name={`${leader.firstName ?? ""} ${leader.lastName ?? ""}`}
                    imageUrl={leader.profilePhoto}
                    size={24}
                  />
                  <Text style={[s.dropdownItemText, { color: colors.text }]}>
                    {leader.firstName} {leader.lastName}
                  </Text>
                </TouchableOpacity>
              );
            })}
            {crossGroupAssignees.map((group) => (
              <View key={group.groupId}>
                <View style={[s.dropdownGroupHeader, { borderTopColor: colors.borderLight }]}>
                  <Text style={[s.dropdownGroupHeaderText, { color: colors.textTertiary }]}>
                    {group.groupName}
                  </Text>
                </View>
                {group.leaders.map((leader) => (
                  <View
                    key={leader.userId}
                    style={[s.dropdownItem, { opacity: 0.5 }]}
                  >
                    <Ionicons name="checkbox" size={16} color={colors.iconSecondary} />
                    <Avatar
                      name={`${leader.firstName} ${leader.lastName}`}
                      imageUrl={leader.profilePhoto}
                      size={24}
                    />
                    <Text style={[s.dropdownItemText, { color: colors.iconSecondary }]}>
                      {leader.firstName} {leader.lastName}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
          {getAssigneeIds(activeDropdownMember).length > 0 && (
            <TouchableOpacity
              style={[s.dropdownItem, s.dropdownItemDanger, { borderTopColor: colors.borderLight }]}
              onPress={() => {
                // Preserve cross-group assignees — only clear current group's assignments
                const crossIds = crossGroupAssignees.flatMap((g) =>
                  g.leaders.map((l) => l.userId),
                );
                handleAssigneeSelect(
                  activeDropdownMember.groupMemberId,
                  crossIds,
                );
              }}
            >
              <Text style={[s.dropdownItemText, { color: colors.destructive }]}>
                Clear all assignees
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {dropdownPos && statusDropdownFor && activeDropdownMember && (
        <View
          style={[
            s.dropdownPortal,
            {
              top: dropdownPos.top,
              left: dropdownPos.left,
              minWidth: dropdownPos.width,
              backgroundColor: colors.background,
              borderColor: colors.border,
            },
          ]}
          data-dropdown="true"
        >
          {getStatusOptions(colors).map((opt) => (
            <TouchableOpacity
              key={opt.label}
              style={[s.dropdownItem, { backgroundColor: opt.color }]}
              onPress={() =>
                handleStatusSelect(
                  activeDropdownMember.groupMemberId,
                  opt.value,
                )
              }
            >
              <Text style={[s.dropdownItemText, { color: colors.text }]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Custom field dropdown portal */}
      {dropdownPos &&
        customDropdownFor &&
        (() => {
          const cf = customFields.find(
            (f) => f.slot === customDropdownFor.slot,
          );
          const member = displayMembers.find(
            (m) => m.groupMemberId === customDropdownFor.memberId,
          );
          if (!cf || !member) return null;

          if (cf.type === "multiselect") {
            const options = selectOptionsBySlot.get(cf.slot) ?? [];
            const hasOptions = options.length > 0;
            const optState = optimistic[member.groupMemberId] as
              | Record<string, any>
              | undefined;
            const currentValue = String(
              optState?.[cf.slot] !== undefined
                ? (optState[cf.slot] ?? "")
                : ((member as any)[cf.slot] ?? ""),
            );
            const selectedValues = parseMultiSelectValues(currentValue);

            return (
              <View
                style={[
                  s.dropdownPortal,
                  {
                    top: dropdownPos.top,
                    left: dropdownPos.left,
                    minWidth: dropdownPos.width,
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                  },
                ]}
                data-dropdown="true"
              >
                {hasOptions ? (
                  options.map((opt) => {
                    const isChecked = selectedValues.includes(opt);
                    return (
                      <TouchableOpacity
                        key={opt}
                        style={[
                          s.dropdownItem,
                          isChecked && { backgroundColor: colors.surfaceSecondary },
                        ]}
                        onPress={() =>
                          handleMultiSelectToggle(
                            member.groupMemberId,
                            cf.slot,
                            currentValue,
                            opt,
                          )
                        }
                      >
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <Ionicons
                            name={isChecked ? "checkbox" : "square-outline"}
                            size={16}
                            color={isChecked ? colors.link : colors.iconSecondary}
                          />
                          <Text style={[s.dropdownItemText, { color: colors.text }]}>{opt}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })
                ) : (
                  <View style={s.dropdownItem}>
                    <Text style={[s.dropdownItemText, { color: colors.text }]}>
                      No options configured
                    </Text>
                  </View>
                )}
                {selectedValues.length > 0 && (
                  <TouchableOpacity
                    style={[s.dropdownItem, s.dropdownItemDanger, { borderTopColor: colors.borderLight }]}
                    onPress={() => {
                      handleCustomFieldSave(
                        member.groupMemberId,
                        cf.slot,
                        undefined,
                      );
                    }}
                  >
                    <Text style={[s.dropdownItemText, { color: colors.destructive }]}>
                      Clear all
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          }

          if (cf.type === "dropdown") {
            const options = selectOptionsBySlot.get(cf.slot) ?? [];
            const hasOptions = options.length > 0;
            const optState = optimistic[member.groupMemberId] as
              | Record<string, any>
              | undefined;
            const currentValue = String(
              optState?.[cf.slot] !== undefined
                ? (optState[cf.slot] ?? "")
                : ((member as any)[cf.slot] ?? ""),
            );
            return (
              <View
                style={[
                  s.dropdownPortal,
                  {
                    top: dropdownPos.top,
                    left: dropdownPos.left,
                    minWidth: dropdownPos.width,
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                  },
                ]}
                data-dropdown="true"
              >
                {hasOptions ? (
                  options.map((opt) => (
                    <TouchableOpacity
                      key={opt}
                      style={s.dropdownItem}
                      onPress={() =>
                        handleCustomFieldSave(
                          member.groupMemberId,
                          cf.slot,
                          opt,
                        )
                      }
                    >
                      <Text style={[s.dropdownItemText, { color: colors.text }]}>{opt}</Text>
                    </TouchableOpacity>
                  ))
                ) : (
                  <View style={s.dropdownItem}>
                    <Text style={[s.dropdownItemText, { color: colors.text }]}>
                      No options configured
                    </Text>
                  </View>
                )}
                {currentValue && (
                  <TouchableOpacity
                    style={[s.dropdownItem, s.dropdownItemDanger, { borderTopColor: colors.borderLight }]}
                    onPress={() =>
                      handleCustomFieldSave(
                        member.groupMemberId,
                        cf.slot,
                        undefined,
                      )
                    }
                  >
                    <Text style={[s.dropdownItemText, { color: colors.destructive }]}>
                      Clear
                    </Text>
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
                {
                  top: dropdownPos.top,
                  left: dropdownPos.left,
                  minWidth: dropdownPos.width,
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                },
              ]}
              data-dropdown="true"
            >
              {cf.options.map((opt) => (
                <TouchableOpacity
                  key={opt}
                  style={s.dropdownItem}
                  onPress={() =>
                    handleCustomFieldSave(member.groupMemberId, cf.slot, opt)
                  }
                >
                  <Text style={[s.dropdownItemText, { color: colors.text }]}>{opt}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={[s.dropdownItem, s.dropdownItemDanger, { borderTopColor: colors.borderLight }]}
                onPress={() =>
                  handleCustomFieldSave(
                    member.groupMemberId,
                    cf.slot,
                    undefined,
                  )
                }
              >
                <Text style={[s.dropdownItemText, { color: colors.destructive }]}>
                  Clear
                </Text>
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

      {/* Save view modal */}
      {groupData?.communityId && (
        <SaveViewModal
          visible={showSaveViewModal}
          onClose={() => {
            setShowSaveViewModal(false);
          }}
          onSave={() => {
            setLocalColumnOrder(null);
            setLocalHiddenColumns(null);
          }}
          communityId={groupData?.communityId ?? communityId!}
          currentSortBy={sortField}
          currentSortDirection={sortDirection}
          currentColumnOrder={localColumnOrder ?? columnConfig?.columnOrder}
          currentHiddenColumns={
            localHiddenColumns ?? columnConfig?.hiddenColumns
          }
          currentFilters={saveViewFilters}
          isAdmin={user?.is_admin === true}
        />
      )}

      {/* Column header context menu (web only) */}
      {headerContextMenu && Platform.OS === "web" && (
        <>
          <Pressable
            style={s.contextMenuBackdrop}
            onPress={() => setHeaderContextMenu(null)}
          />
          <View
            style={[
              s.contextMenu,
              { top: headerContextMenu.top, left: headerContextMenu.left, backgroundColor: colors.background, borderColor: colors.border },
            ]}
          >
            <TouchableOpacity
              style={s.contextMenuItem}
              onPress={() => {
                const currentOrder = localColumnOrder ?? allColumnKeys;
                const currentHidden = localHiddenColumns ?? [];
                setLocalColumnOrder(currentOrder);
                setLocalHiddenColumns([
                  ...currentHidden,
                  headerContextMenu.colKey,
                ]);
                setActiveViewId(null);
                setHeaderContextMenu(null);
              }}
            >
              <Ionicons name="eye-off-outline" size={14} color={colors.textSecondary} />
              <Text style={[s.contextMenuText, { color: colors.text }]}>
                Hide "{headerContextMenu.colLabel}"
              </Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* Delete view confirmation modal */}
      <ConfirmModal
        visible={!!viewToDelete}
        title={`Delete "${viewToDelete?.name ?? ""}"?`}
        message={
          viewToDelete?.isShared
            ? `"${viewToDelete.name}" is shared with your team. Deleting it will remove it for everybody.`
            : "This view will be permanently deleted."
        }
        onConfirm={async () => {
          if (!viewToDelete) return;
          if (activeViewId === viewToDelete.id) {
            setActiveViewId(null);
            setLocalColumnOrder(null);
            setLocalHiddenColumns(null);
          }
          await deleteViewMut({
            viewId: viewToDelete.id as Id<"peopleSavedViews">,
          });
          setViewToDelete(null);
        }}
        onCancel={() => setViewToDelete(null)}
        confirmText="Delete"
        destructive
      />

      <ScoreBreakdownModal data={scoreBreakdownSheet} onClose={() => setScoreBreakdownSheet(null)} />
    </View>
  );
}

// ============================================================================
// Styles
// ============================================================================

const s = StyleSheet.create({
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
    fontWeight: "bold" as const,
  },
  headerSubtitle: {
    fontSize: 14,
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
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginRight: 8,
  },
  importButtonText: {
    fontSize: 12,
    fontWeight: "600" as const,
  },
  addButton: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginRight: 8,
  },
  addButtonText: {
    fontSize: 12,
    fontWeight: "600" as const,
  },

  // Search bar
  searchBar: {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    gap: 12,
  },
  searchInputContainer: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    borderWidth: 1,
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
    ...(Platform.OS === "web" ? { outlineStyle: "none" as any } : {}),
  },
  memberCount: {
    fontSize: 13,
    fontWeight: "500" as const,
    paddingTop: 8,
  },
  searchHelperText: {
    fontSize: 11,
  },
  searchSuggestionBox: {
    borderWidth: 1,
    borderRadius: 8,
    overflow: "hidden",
  },
  searchSuggestionRow: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  searchSuggestionLabel: {
    fontSize: 12,
    fontWeight: "600" as const,
  },
  searchSuggestionHelp: {
    fontSize: 11,
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
  },
  headerRow: {
    flexDirection: "row" as const,
    borderBottomWidth: 2,
    // Sticky on web
    ...(Platform.OS === "web"
      ? { position: "sticky" as any, top: 0, zIndex: 10 }
      : {}),
  },
  headerCell: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    position: "relative" as const,
    borderRightWidth: 1,
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
    textTransform: "uppercase" as const,
  },
  headerTextActive: {},
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
    minHeight: 44,
  },
  dataRowChecked: {},
  dataRowSelected: {},
  dataRowHovered: {},
  dataCell: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    justifyContent: "center" as const,
    borderRightWidth: 1,
  },
  dataCellEditable: {
    ...(Platform.OS === "web" ? { cursor: "cell" as any } : {}),
  },
  dataCellEditableHovered: {},
  rowNumText: {
    fontSize: 12,
    textAlign: "center" as const,
  },
  nameCellRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  cellText: {
    fontSize: 13,
  },
  cellTextSmall: {
    fontSize: 12,
  },
  cellPlaceholder: {
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
    borderRadius: 12,
    paddingLeft: 2,
    paddingRight: 8,
    paddingVertical: 2,
    alignSelf: "flex-start" as const,
    gap: 4,
  },
  assigneeBadgeText: {
    fontSize: 12,
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
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  taskChipText: {
    fontSize: 12,
    fontWeight: "500" as const,
  },
  taskOverflowText: {
    fontSize: 11,
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
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },

  // Multiselect chips
  multiSelectChip: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  multiSelectChipText: {
    fontSize: 11,
  },

  // Alerts
  alertsCell: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 4,
  },
  alertChip: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  alertChipText: {
    fontSize: 11,
    fontWeight: "500" as const,
  },

  // Dropdown portal — rendered at fixed position outside ScrollView
  dropdownPortal: {
    position: Platform.OS === "web" ? ("fixed" as any) : ("absolute" as const),
    minWidth: 200,
    borderRadius: 8,
    borderWidth: 1,
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
    marginTop: 4,
  },
  dropdownItemText: {
    fontSize: 13,
  },
  dropdownGroupHeader: {
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 4,
    borderTopWidth: 1,
    marginTop: 4,
  },
  dropdownGroupHeaderText: {
    fontSize: 11,
    fontWeight: "600" as const,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  },

  // Side sheet
  divider: {
    width: 1,
  },
  sideSheet: {
    width: 420,
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
    borderBottomWidth: 1,
  },
  actionBarLeft: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
  },
  actionBarCount: {
    fontSize: 13,
    fontWeight: "600" as const,
  },
  actionBarDeselect: {
    fontSize: 13,
    textDecorationLine: "underline" as const,
  },
  actionBarRemoveButton: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  actionBarRemoveText: {
    fontSize: 13,
    fontWeight: "600" as const,
  },

  // Unsaved column changes bar
  unsavedBar: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  unsavedText: {
    fontSize: 12,
    flex: 1,
  },
  unsavedAction: {
    fontSize: 12,
    fontWeight: "600" as const,
  },
  unsavedDiscard: {
    fontSize: 12,
  },

  // Column header context menu
  contextMenuBackdrop: {
    ...(Platform.OS === "web"
      ? {
          position: "fixed" as any,
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 9998,
        }
      : {}),
  },
  contextMenu: {
    ...(Platform.OS === "web"
      ? {
          position: "fixed" as any,
          zIndex: 9999,
          borderRadius: 8,
          borderWidth: 1,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.15,
          shadowRadius: 12,
          paddingVertical: 4,
          minWidth: 180,
        }
      : {}),
  },
  contextMenuItem: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  contextMenuText: {
    fontSize: 13,
  },
});
