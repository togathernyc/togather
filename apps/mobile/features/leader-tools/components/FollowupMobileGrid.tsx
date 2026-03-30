import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
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
import { useAuth } from "@providers/AuthProvider";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import {
  api,
  Id,
  useAuthenticatedPaginatedQuery,
  useAuthenticatedMutation,
  useAuthenticatedQuery,
  useQuery,
} from "@services/api/convex";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import {
  SUBTITLE_VARIABLE_MAP,
  type SubtitleVariable,
  getSystemScoreValue,
  SYSTEM_SCORE_COLUMNS,
  normalizeSubtitleVariableIds,
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
import type { CustomFieldDef } from "./ColumnPickerModal";
import { FollowupQuickAddPanel } from "./FollowupQuickAddPanel";
import { FollowupMapView, FOLLOWUP_MAP_VIEW_ID } from "./FollowupMapView";
import { useTheme } from "@hooks/useTheme";
import type { ThemeColors } from "@/theme/colors";

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
  lastActiveAt?: number;
  status?: string;
  assigneeId?: string;
  assigneeIds?: string[];
  addedAt?: number;
  email?: string;
  phone?: string;
  zipCode?: string;
  dateOfBirth?: number;
  latestNote?: string;
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
  kind:
    | "score"
    | "status"
    | "text"
    | "boolean"
    | "dropdown"
    | "multiselect"
    | "number";
  editable?: "assignee" | "status" | "custom";
  customField?: CustomFieldDef;
  getValue: (member: FollowupMember) => string | number | boolean;
};
const MEMBER_COL_WIDTH = 140;
const SELECT_COL_WIDTH = 40;

const STATUS_OPTIONS: Array<{ value?: string; label: string }> = [
  { value: "green", label: "Green" },
  { value: "orange", label: "Orange" },
  { value: "red", label: "Red" },
  { value: undefined, label: "Clear status" },
];

const SERVER_SORTABLE_FIELDS = new Set([
  "score1",
  "score2",
  "score3",
  "firstName",
  "lastName",
  "addedAt",
  "lastAttendedAt",
  "lastFollowupAt",
  "lastActiveAt",
  "status",
  "assignee",
]);

const HIDE_ON_MOBILE_COLUMNS = new Set(["firstName", "lastName"]);

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}

function getScoreStyles(value: number, colors: ThemeColors) {
  if (value >= 70) {
    return { border: colors.success, bg: colors.surfaceSecondary, text: colors.success };
  }
  if (value >= 40) {
    return { border: colors.warning, bg: colors.surfaceSecondary, text: colors.warning };
  }
  return { border: colors.destructive, bg: colors.surfaceSecondary, text: colors.destructive };
}

function getStatusStyles(status: string | undefined, colors: ThemeColors): { bg: string; text: string } {
  switch (status) {
    case "green":
      return { bg: colors.surfaceSecondary, text: colors.success };
    case "orange":
      return { bg: colors.surfaceSecondary, text: colors.warning };
    case "red":
      return { bg: colors.surfaceSecondary, text: colors.destructive };
    default:
      return { bg: colors.surfaceSecondary, text: colors.textSecondary };
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
  direction: SortDirection,
): number {
  const multiplier = direction === "asc" ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") {
    return (a - b) * multiplier;
  }
  return (
    String(a).localeCompare(String(b), undefined, { sensitivity: "base" }) *
    multiplier
  );
}

export function FollowupMobileGrid({
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
  const insets = useSafeAreaInsets();
  const { community, user } = useAuth();
  const communityId = community?.id as Id<"communities"> | undefined;
  const currentUserId = user?.id as Id<"users"> | undefined;
  const { primaryColor } = useCommunityTheme();

  const [sortField, setSortField] = useState("score3");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [editSheet, setEditSheet] = useState<{
    type:
      | "assignee"
      | "status"
      | "customText"
      | "customDropdown"
      | "customMultiselect";
    memberId: string;
    customField?: CustomFieldDef;
    initialValue?: string;
  } | null>(null);
  const [customFieldInput, setCustomFieldInput] = useState("");
  const [isUpdatingField, setIsUpdatingField] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [showQuickAddModal, setShowQuickAddModal] = useState(false);
  const [scoreBreakdownSheet, setScoreBreakdownSheet] = useState<{
    memberId: string;
    memberName: string;
    scores: Array<{ id: string; name: string; slot: string; value: number }>;
  } | null>(null);

  // PeopleViewBar state (system_scores feature flag)
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [showSaveViewModal, setShowSaveViewModal] = useState(false);

  // Delete confirmation state
  const [viewToDelete, setViewToDelete] = useState<{
    id: string; name: string; isShared: boolean;
  } | null>(null);
  const isMapViewActive = activeViewId === FOLLOWUP_MAP_VIEW_ID;

  const [localOverrides, setLocalOverrides] = useState<
    Record<
      string,
      {
        assigneeIds?: string[] | null;
        status?: string | null;
        [key: string]: string | string[] | number | boolean | null | undefined;
      }
    >
  >({});

  // Cross-group config — fetched so we have community-wide leaders for assignee picker
  const crossGroupConfig = useAuthenticatedQuery(
    api.functions.memberFollowups.getCrossGroupConfig,
    {},
  );

  const debouncedSearch = useDebounce(searchQuery, 450);

  const perGroupConfig = useAuthenticatedQuery(
    api.functions.memberFollowups.getFollowupConfig,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip",
  );
  const config = perGroupConfig;

  const groupData = useQuery(
    api.functions.groups.index.getById,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip",
  );

  const communityPeopleConfig = useAuthenticatedQuery(
    groupData?.communityId
      ? api.functions.communityPeople.getConfig
      : ("skip" as any),
    groupData?.communityId
      ? { communityId: groupData.communityId }
      : "skip",
  );

  const scoreConfig = useMemo<ScoreConfigEntry[]>(
    () => communityPeopleConfig?.scores?.map((s: any) => ({ id: s.id, name: s.name })) ?? [],
    [communityPeopleConfig?.scores],
  );
  const isConfigLoaded = config !== undefined;
  const toolDisplayName = typeof perGroupConfig?.toolDisplayName === "string" ? perGroupConfig.toolDisplayName : "People";
  const memberSubtitleRaw = (config as any)?.memberSubtitle ?? "";
  const memberSubtitleIds = useMemo(
    () =>
      normalizeSubtitleVariableIds(
        typeof memberSubtitleRaw === "string" ? memberSubtitleRaw : "",
      ),
    [memberSubtitleRaw],
  );
  const columnConfig = perGroupConfig?.followupColumnConfig ?? null;
  const customFields = useMemo<CustomFieldDef[]>(
    () => (communityPeopleConfig?.customFields ?? []) as CustomFieldDef[],
    [communityPeopleConfig?.customFields],
  );

  const perGroupLeaders = useAuthenticatedQuery(
    api.functions.groups.members.getLeaders,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip",
  );
  // Use all community leaders so any leader can be assigned across groups
  const leaders = crossGroupConfig?.leaders ?? perGroupLeaders;

  const groupTasks = useAuthenticatedQuery(
    api.functions.tasks.index.listGroup,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip",
  );

  const tasksByMember = useMemo(() => {
    const map = new Map<string, Array<{ _id: string; title: string; status: string; assignedToName?: string }>>();
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
      });
    }
    return map;
  }, [groupTasks]);

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
      ]),
    );
  }, [leaders]);

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

  useEffect(() => {
    if (!sortField.startsWith("score")) return;
    // Don't override the default score sort while config is still loading.
    if (!isConfigLoaded) return;
    // System scores always have score1-score3; validate against those.
    const validSlots = new Set(SYSTEM_SCORE_COLUMNS.map((sc) => sc.slot));
    if (!validSlots.has(sortField as "score1" | "score2" | "score3")) {
      setSortField("score3");
    }
  }, [isConfigLoaded, scoreConfig, sortField]);

  const parsedQuery = useMemo(
    () => parseFollowupQuerySyntax(debouncedSearch, leaderMap, scoreConfig, true, currentUserId ?? undefined),
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
  const hasTextSearch = parsedQuery.searchText.length > 0;
  const hasStructuredFilters =
    !!parsedQuery.statusFilter ||
    !!parsedQuery.assigneeFilter ||
    parsedQuery.scoreMax !== undefined ||
    parsedQuery.scoreMin !== undefined ||
    parsedQuery.excludedAssigneeFilters.length > 0 ||
    !!parsedQuery.dateAddedFilter;
  const searchSuggestions = useMemo(
    () => getFollowupSearchSuggestions(searchQuery, scoreConfig, true),
    [searchQuery, scoreConfig],
  );
  const searchHelperText = useMemo(
    () => getFollowupQueryHelperText(searchQuery, scoreConfig, true),
    [searchQuery, scoreConfig],
  );
  const showSearchSuggestions =
    isSearchFocused &&
    searchQuery.trim().length > 0 &&
    searchSuggestions.length > 0;

  // Effective assignee filter: enforced prop takes priority over search syntax
  const effectiveAssigneeFilter = enforcedAssigneeUserId
    ? (enforcedAssigneeUserId as Id<"users">)
    : parsedQuery.assigneeFilter
      ? (parsedQuery.assigneeFilter as Id<"users">)
      : undefined;

  const listFilterArgs = useMemo(() => {
    const filters: Record<string, unknown> = {};
    const dateRangeArgs = getDateAddedRangeArgs(parsedQuery.dateAddedFilter);
    if (parsedQuery.statusFilter)
      filters.statusFilter = parsedQuery.statusFilter;
    if (effectiveAssigneeFilter)
      filters.assigneeFilter = effectiveAssigneeFilter;
    if (enforcedAssigneeUserId)
      filters.requireSelfAssignee = true;
    if (parsedQuery.excludedAssigneeFilters.length > 0) {
      filters.excludedAssigneeFilters =
        parsedQuery.excludedAssigneeFilters as Id<"users">[];
    }
    if (parsedQuery.scoreField) filters.scoreField = parsedQuery.scoreField;
    if (parsedQuery.scoreMax !== undefined)
      filters.scoreMax = parsedQuery.scoreMax;
    if (parsedQuery.scoreMin !== undefined)
      filters.scoreMin = parsedQuery.scoreMin;
    if (dateRangeArgs.addedAtMin !== undefined)
      filters.addedAtMin = dateRangeArgs.addedAtMin;
    if (dateRangeArgs.addedAtMax !== undefined)
      filters.addedAtMax = dateRangeArgs.addedAtMax;
    return filters;
  }, [parsedQuery, effectiveAssigneeFilter, enforcedAssigneeUserId]);

  const isClientSideSort = !SERVER_SORTABLE_FIELDS.has(sortField);
  const serverSortBy = SERVER_SORTABLE_FIELDS.has(sortField)
    ? sortField
    : "score3";
  const serverSortDirection = isClientSideSort ? "desc" : sortDirection;

  const {
    results: perGroupRawMembersRaw,
    status: paginationStatus,
    loadMore,
    isLoading,
  } = useAuthenticatedPaginatedQuery(
    api.functions.communityPeople.list,
    !hasTextSearch && groupId
      ? {
          groupId: groupId as Id<"groups">,
          sortBy: serverSortBy,
          sortDirection: serverSortDirection,
          ...listFilterArgs,
        }
      : "skip",
    { initialNumItems: 50 },
  );
  const rawMembers = useMemo(
    () => applyDevZipCodeSample(perGroupRawMembersRaw.map(adaptCommunityPerson)),
    [perGroupRawMembersRaw],
  );

  const perGroupSearchResultsRaw = useAuthenticatedQuery(
    api.functions.communityPeople.search,
    hasTextSearch && groupId
      ? {
          groupId: groupId as Id<"groups">,
          searchTerm: parsedQuery.searchText,
          ...(effectiveAssigneeFilter
            ? { assigneeFilter: effectiveAssigneeFilter }
            : {}),
          ...(enforcedAssigneeUserId
            ? { requireSelfAssignee: true as const }
            : {}),
        }
      : "skip",
  );
  const searchResults = useMemo(
    () =>
      perGroupSearchResultsRaw
        ? applyDevZipCodeSample(perGroupSearchResultsRaw.map(adaptCommunityPerson))
        : undefined,
    [perGroupSearchResultsRaw],
  );

  const totalCount = useAuthenticatedQuery(
    api.functions.communityPeople.count,
    groupId
      ? { groupId: groupId as Id<"groups"> }
      : "skip",
  );
  const setAssigneeMut = useAuthenticatedMutation(
    api.functions.communityPeople.setAssignees,
  );
  const setStatusMut = useAuthenticatedMutation(
    api.functions.communityPeople.setStatus,
  );
  const setCustomFieldMut = useAuthenticatedMutation(
    api.functions.communityPeople.setCustomField,
  );
  const removeGroupMember = useAuthenticatedMutation(
    api.functions.groupMembers.remove,
  );
  const removeCommunityMember = useAuthenticatedMutation(
    api.functions.communities.removeMember,
  );
  const deleteViewMut = useAuthenticatedMutation(
    api.functions.peopleSavedViews.remove,
  );

  const getMemberGroupId = useCallback(
    (_memberId: string): Id<"groups"> => {
      return groupId as Id<"groups">;
    },
    [groupId]
  );

  const getSortFieldValue = useCallback(
    (member: FollowupMember, field: string): string | number => {
      if (field.startsWith("score")) {
        // System scores: direct slot access (score1, score2, score3)
        const slot = field as "score1" | "score2" | "score3";
        return getSystemScoreValue(member, slot) ?? 0;
      }

      switch (field) {
        case "firstName":
          return member.firstName ?? "";
        case "lastName":
          return member.lastName ?? "";
        case "addedAt":
          return member.addedAt ?? 0;
        case "status":
          return member.status ?? "";
        case "assignee": {
          const assigneeIds = getAssigneeIds(member);
          if (assigneeIds.length === 0) return "";
          const leader = leaderMap.get(assigneeIds[0]);
          return leader ? `${leader.firstName} ${leader.lastName}`.trim() : "";
        }
        case "lastAttendedAt":
          return member.lastAttendedAt ?? 0;
        case "lastFollowupAt":
          return member.lastFollowupAt ?? 0;
        case "lastActiveAt":
          return member.lastActiveAt ?? 0;
        default:
          if (field.startsWith("customBool")) {
            return (member as Record<string, unknown>)[field] ? 1 : 0;
          }
          return (
            ((member as Record<string, unknown>)[field] as
              | string
              | number
              | undefined
              | null) ?? ""
          );
      }
    },
    [leaderMap, getAssigneeIds],
  );

  const members = useMemo(() => {
    const source = (
      hasTextSearch ? (searchResults ?? []) : (rawMembers ?? [])
    ) as FollowupMember[];
    if (source.length === 0) return [];
    const filtered = applyParsedFollowupFilters(source, parsedQuery);
    if (!hasTextSearch && !isClientSideSort) return filtered;

    const sorted = [...filtered];
    sorted.sort((a, b) =>
      compareSortValues(
        getSortFieldValue(a, sortField),
        getSortFieldValue(b, sortField),
        sortDirection,
      ),
    );
    return sorted;
  }, [
    hasTextSearch,
    searchResults,
    rawMembers,
    isClientSideSort,
    parsedQuery,
    sortField,
    sortDirection,
    getSortFieldValue,
  ]);

  const isSearchLoading = hasTextSearch && searchResults === undefined;
  const lastMembersRef = useRef<FollowupMember[]>([]);
  const membersToShow = useMemo(() => {
    if (members.length > 0) {
      lastMembersRef.current = members;
      return members;
    }
    if (isSearchLoading || (!hasTextSearch && isLoading)) {
      return lastMembersRef.current.length > 0 ? lastMembersRef.current : [];
    }
    return [];
  }, [members, isSearchLoading, isLoading, hasTextSearch]);

  // Keep inline edits responsive while server updates stream in.
  const displayMembers = useMemo(() => {
    const source = membersToShow;
    if (Object.keys(localOverrides).length === 0) return source;
    return source.map((member) => {
      const override = localOverrides[member.groupMemberId];
      if (!override) return member;
      const result: FollowupMember = {
        ...member,
        assigneeIds:
          override.assigneeIds !== undefined
            ? ((override.assigneeIds ?? []) as string[])
            : member.assigneeIds,
        assigneeId:
          override.assigneeIds !== undefined
            ? ((override.assigneeIds ?? [])[0] as string | undefined)
            : member.assigneeId,
        status:
          override.status !== undefined
            ? (override.status ?? undefined)
            : member.status,
      };
      // Apply custom field overrides
      for (const [key, val] of Object.entries(override)) {
        if (key.startsWith("custom")) {
          (result as Record<string, unknown>)[key] = val ?? undefined;
        }
      }
      return result;
    });
  }, [membersToShow, localOverrides]);

  const selectOptionsBySlot = useMemo(
    () => buildSelectOptionsBySlot(customFields, displayMembers as unknown as Record<string, unknown>[]),
    [customFields, displayMembers]
  );

  useEffect(() => {
    if (Object.keys(localOverrides).length === 0) return;
    const memberMap = new Map(
      members.map((member) => [member.groupMemberId, member]),
    );
    const next: typeof localOverrides = {};
    let changed = false;

    for (const [memberId, override] of Object.entries(localOverrides)) {
      const serverMember = memberMap.get(memberId);
      if (!serverMember) {
        next[memberId] = override;
        continue;
      }
      const pending: typeof override = {};
      if (override.assigneeIds !== undefined) {
        const serverAssigneeIds = getAssigneeIds(serverMember);
        const overrideAssigneeIds = (override.assigneeIds ?? []) as string[];
        const sameAssignees =
          JSON.stringify(serverAssigneeIds) ===
          JSON.stringify(overrideAssigneeIds);
        if (!sameAssignees) {
          pending.assigneeIds = override.assigneeIds;
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
      // Handle custom field overrides
      for (const [key, val] of Object.entries(override)) {
        if (key.startsWith("custom") && val !== undefined) {
          const serverVal =
            (serverMember as Record<string, unknown>)[key] ?? null;
          if (serverVal !== (val ?? null)) {
            pending[key] = val;
          } else {
            changed = true;
          }
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
  }, [members, localOverrides, getAssigneeIds]);

  const dataColumns: GridColumn[] = useMemo(() => {
    // Always use fixed SYSTEM_SCORE_COLUMNS for score columns.
    const scoreColumns: GridColumn[] = SYSTEM_SCORE_COLUMNS.map((sc) => ({
      key: sc.slot,
      label: sc.name,
      width: 72,
      sortable: true,
      kind: "score" as const,
      getValue: (member: FollowupMember) =>
        getSystemScoreValue(member, sc.slot) ?? 0,
    }));

    const baseColumns: GridColumn[] = [
      {
        key: "addedAt",
        label: "Date Added",
        width: 88,
        sortable: true,
        kind: "text",
        getValue: (member) => formatDate(member.addedAt, "\u2014"),
      },
      {
        key: "firstName",
        label: "First Name",
        width: 100,
        sortable: true,
        kind: "text",
        getValue: (member) => member.firstName ?? "",
      },
      {
        key: "lastName",
        label: "Last Name",
        width: 100,
        sortable: true,
        kind: "text",
        getValue: (member) => member.lastName ?? "",
      },
      {
        key: "email",
        label: "Email",
        width: 140,
        sortable: false,
        kind: "text",
        getValue: (member) => member.email ?? "",
      },
      {
        key: "phone",
        label: "Phone",
        width: 100,
        sortable: false,
        kind: "text",
        getValue: (member) => member.phone ?? "",
      },
      {
        key: "zipCode",
        label: "ZIP Code",
        width: 72,
        sortable: false,
        kind: "text",
        getValue: (member) => member.zipCode ?? "",
      },
      {
        key: "dateOfBirth",
        label: "Birthday",
        width: 88,
        sortable: false,
        kind: "text",
        getValue: (member) => formatDate(member.dateOfBirth, "\u2014"),
      },
      ...scoreColumns,
      {
        key: "status",
        label: "Status",
        width: 80,
        sortable: true,
        kind: "status",
        editable: "status",
        getValue: (member) => member.status ?? "none",
      },
      {
        key: "assignee",
        label: "Assignees",
        width: 110,
        sortable: true,
        kind: "text",
        editable: "assignee",
        getValue: (member) => {
          const assigneeIds = getAssigneeIds(member);
          if (assigneeIds.length === 0) return "Unassigned";
          const names = assigneeIds
            .map((id) => leaderMap.get(id))
            .filter((leader): leader is LeaderInfo => !!leader)
            .map((leader) => `${leader.firstName} ${leader.lastName}`.trim());
          if (names.length === 0) return "Unassigned";
          if (names.length === 1) return names[0];
          return `${names[0]} +${names.length - 1}`;
        },
      },
      {
        key: "alerts",
        label: "Alerts",
        width: 64,
        sortable: false,
        kind: "text",
        getValue: (member) => String(member.alerts?.length ?? 0),
      },
      {
        key: "notes",
        label: "Notes",
        width: 160,
        sortable: false,
        kind: "text",
        getValue: (member) => member.latestNote ?? "",
      },
      {
        key: "tasks",
        label: "Tasks",
        width: 140,
        sortable: false,
        kind: "text",
        getValue: (member) => {
          const tasks = tasksByMember.get(member.userId) ?? [];
          if (tasks.length === 0) return "\u2014";
          if (tasks.length === 1)
            return `${tasks[0].assignedToName ?? "Unassigned"} \u2014 ${tasks[0].title}`;
          return `${tasks.length} tasks`;
        },
      },
      {
        key: "missedMeetings",
        label: "Missed",
        width: 64,
        sortable: false,
        kind: "text",
        getValue: (member) => String(member.missedMeetings ?? 0),
      },
      {
        key: "consecutiveMissed",
        label: "Streak",
        width: 56,
        sortable: false,
        kind: "text",
        getValue: (member) => String(member.consecutiveMissed ?? 0),
      },
      {
        key: "lastAttendedAt",
        label: "Last Attended",
        width: 92,
        sortable: true,
        kind: "text",
        getValue: (member) => formatDate(member.lastAttendedAt, "\u2014"),
      },
      {
        key: "lastFollowupAt",
        label: "Last Contact",
        width: 96,
        sortable: true,
        kind: "text",
        getValue: (member) => formatDate(member.lastFollowupAt, "\u2014"),
      },
      {
        key: "lastActiveAt",
        label: "Date Active",
        width: 92,
        sortable: true,
        kind: "text",
        getValue: (member) => formatDate(member.lastActiveAt, "\u2014"),
      },
    ];

    const customColumns: GridColumn[] = customFields.map((field) => ({
      key: field.slot,
      label: field.name,
      width:
        field.type === "boolean"
          ? 72
          : field.type === "dropdown"
            ? 100
            : field.type === "multiselect"
              ? 120
              : 120,
      sortable: SERVER_SORTABLE_FIELDS.has(field.slot),
      kind:
        field.type === "boolean"
          ? "boolean"
          : field.type === "dropdown"
            ? "dropdown"
            : field.type === "multiselect"
              ? "multiselect"
              : field.type === "number"
                ? "number"
                : "text",
      editable: "custom",
      customField: field,
      getValue: (member) => {
        const raw = (member as Record<string, unknown>)[field.slot];
        if (field.type === "boolean") return Boolean(raw);
        return (raw as string | number | undefined) ?? "";
      },
    }));

    const allAvailable = [...baseColumns, ...customColumns];
    const byKey = new Map(allAvailable.map((column) => [column.key, column]));
    const savedOrder = columnConfig?.columnOrder ?? [];
    const hidden = new Set(columnConfig?.hiddenColumns ?? []);

    let ordered: GridColumn[];
    if (savedOrder.length > 0) {
      const listed = savedOrder
        .map((key) => byKey.get(key))
        .filter(Boolean) as GridColumn[];
      const listedSet = new Set(listed.map((column) => column.key));
      ordered = [
        ...listed,
        ...allAvailable.filter((column) => !listedSet.has(column.key)),
      ];
    } else {
      ordered = allAvailable;
    }

    return ordered
      .filter((column) => !hidden.has(column.key))
      .filter((column) => !HIDE_ON_MOBILE_COLUMNS.has(column.key));
  }, [scoreConfig, leaderMap, customFields, columnConfig, getAssigneeIds]);

  const dataColumnsWidth = useMemo(
    () => dataColumns.reduce((sum, column) => sum + column.width, 0),
    [dataColumns],
  );
  const pinnedWidth = SELECT_COL_WIDTH + MEMBER_COL_WIDTH;
  const flatListExtraData = useMemo(
    () =>
      [
        sortField,
        sortDirection,
        dataColumns.map((column) => column.key).join("|"),
        editSheet?.memberId ?? "",
        editSheet?.type ?? "",
        isUpdatingField ? "1" : "0",
        [...selectedIds].join(","),
      ].join(":"),
    [
      sortField,
      sortDirection,
      dataColumns,
      editSheet,
      isUpdatingField,
      selectedIds,
    ],
  );

  const handleSortPress = (field: string) => {
    if (field === sortField) {
      setSortDirection((prevDirection) =>
        prevDirection === "asc" ? "desc" : "asc",
      );
      return;
    }
    setSortField(field);
    setSortDirection("asc");
  };

  const handleBack = () => {
    if (returnTo) {
      router.push(returnTo as any);
    } else if (router.canGoBack()) {
      router.back();
    } else {
      router.push("/(tabs)/profile" as any);
    }
  };

  const handleMemberPress = (memberId: string, _memberGroupId?: string) => {
    router.push(`/(user)/leader-tools/${groupId}/followup/${memberId}`);
  };

  const handleSettingsPress = () => {
    router.push(`/(user)/leader-tools/${groupId}/tool-settings/followup`);
  };

  const handleToggleSelect = useCallback((memberId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) {
        next.delete(memberId);
      } else {
        next.add(memberId);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (members.length > 0 && selectedIds.size === members.length) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(members.map((member) => member.groupMemberId)));
  }, [members, selectedIds.size]);

  useEffect(() => {
    if (selectedIds.size === 0) return;
    const memberIds = new Set(members.map((member) => member.groupMemberId));
    const next = new Set([...selectedIds].filter((id) => memberIds.has(id)));
    if (next.size !== selectedIds.size) {
      setSelectedIds(next);
    }
  }, [members, selectedIds]);

  const handleBulkRemove = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setIsRemoving(true);
    try {
      const selectedMembers = members.filter((member) =>
        selectedIds.has(member.groupMemberId),
      );
      const isAnnouncement = !!groupData?.isAnnouncementGroup;
      const results = await Promise.allSettled(
        selectedMembers.map((member) => {
          if (isAnnouncement) {
            return removeCommunityMember({
              communityId: groupData!.communityId,
              targetUserId: member.userId as Id<"users">,
            });
          }
          return removeGroupMember({
            groupId: getMemberGroupId(member.groupMemberId),
            userId: member.userId as Id<"users">,
          });
        }),
      );
      const failed = results.filter(
        (result) => result.status === "rejected",
      ).length;
      const success = results.length - failed;
      if (failed > 0) {
        Alert.alert("Partial failure", `${success} removed, ${failed} failed.`);
      }
    } catch (error) {
      console.error(
        "[FollowupMobileGrid] Failed to remove selected members:",
        error,
      );
      Alert.alert("Could not remove members", "Please try again.");
    } finally {
      setIsRemoving(false);
      setShowRemoveModal(false);
      setSelectedIds(new Set());
    }
  }, [
    selectedIds,
    members,
    groupData,
    removeCommunityMember,
    removeGroupMember,
    getMemberGroupId,
  ]);

  const getMemberSubtitleLines = (member: FollowupMember): string[] => {
    if (memberSubtitleIds.length === 0) {
      return [
        `${member.missedMeetings} missed`,
        `Last: ${formatDate(member.lastAttendedAt, "Never")}`,
      ];
    }
    return memberSubtitleIds
      .map((id) => SUBTITLE_VARIABLE_MAP.get(id))
      .filter((value): value is SubtitleVariable => value !== undefined)
      .map((variable) =>
        variable.render(member, (value) => formatDate(value, "Never")),
      );
  };

  const activeFilterBadges = useMemo(() => {
    const badges: string[] = [];
    if (parsedQuery.statusFilter)
      badges.push(`status:${parsedQuery.statusFilter}`);
    if (parsedQuery.assigneeFilter) {
      const leader = leaderMap.get(parsedQuery.assigneeFilter);
      badges.push(
        leader
          ? `assignee:${leader.firstName}`
          : `assignee:${parsedQuery.assigneeFilter}`,
      );
    }
    if (parsedQuery.excludedAssigneeFilters.length > 0) {
      for (const assigneeId of parsedQuery.excludedAssigneeFilters) {
        const leader = leaderMap.get(assigneeId);
        badges.push(
          leader ? `-assignee:${leader.firstName}` : `-assignee:${assigneeId}`,
        );
      }
    }
    if (parsedQuery.scoreField) {
      const scoreIndex =
        Number.parseInt(parsedQuery.scoreField.replace("score", ""), 10) - 1;
      const scoreLabel =
        SYSTEM_SCORE_COLUMNS[scoreIndex]?.name ?? parsedQuery.scoreField;
      if (parsedQuery.scoreMin !== undefined)
        badges.push(`${scoreLabel}:>${parsedQuery.scoreMin}`);
      if (parsedQuery.scoreMax !== undefined)
        badges.push(`${scoreLabel}:<${parsedQuery.scoreMax}`);
    }
    if (parsedQuery.dateAddedFilter) {
      const op =
        parsedQuery.dateAddedFilter.operator === "eq"
          ? ""
          : parsedQuery.dateAddedFilter.operator === "lt"
            ? "<"
            : ">";
      badges.push(`date added:${op}${parsedQuery.dateAddedFilter.raw}`);
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
    return (
      displayMembers.find(
        (member) => member.groupMemberId === editSheet.memberId,
      ) ?? null
    );
  }, [editSheet, displayMembers]);

  const closeEditSheet = () => {
    if (isUpdatingField) return;
    setEditSheet(null);
    setCustomFieldInput("");
  };

  const handleCustomFieldSave = useCallback(
    async (
      memberId: string,
      slot: string,
      value: string | number | boolean | undefined,
    ) => {
      setIsUpdatingField(true);
      try {
        await setCustomFieldMut({
          communityPeopleId: memberId as Id<"communityPeople">,
          field: slot,
          value: value ?? null,
        });
      } catch (err) {
        console.error("[FollowupMobileGrid] setCustomField failed:", err);
        Alert.alert("Could not update field", "Please try again.");
      } finally {
        setIsUpdatingField(false);
      }
    },
    [setCustomFieldMut],
  );

  const handleCustomTextSubmit = useCallback(async () => {
    if (!editSheet || !editSheet.customField) return;
    const cf = editSheet.customField;
    let value: string | number | undefined;
    if (cf.type === "number") {
      const num = customFieldInput.trim()
        ? Number(customFieldInput)
        : undefined;
      value = num !== undefined && !Number.isNaN(num) ? num : undefined;
    } else {
      value = customFieldInput.trim() || undefined;
    }
    await handleCustomFieldSave(editSheet.memberId, cf.slot, value);
    setEditSheet(null);
    setCustomFieldInput("");
  }, [editSheet, customFieldInput, handleCustomFieldSave]);

  const handleCustomDropdownSelect = useCallback(
    async (value: string | undefined) => {
      if (!editSheet || !editSheet.customField) return;
      await handleCustomFieldSave(
        editSheet.memberId,
        editSheet.customField.slot,
        value ?? undefined,
      );
      setEditSheet(null);
    },
    [editSheet, handleCustomFieldSave],
  );

  const handleMultiselectToggle = useCallback(
    async (option: string) => {
      if (!editSheet || !editSheet.customField || !activeEditMember) return;
      const slot = editSheet.customField.slot;
      const memberId = editSheet.memberId;
      const serverVal = (activeEditMember as Record<string, unknown>)[slot];

      // Track previous value for rollback - set synchronously within setLocalOverrides
      let previousValue: string | null = null;
      let newValue: string | null = null;

      // Optimistic update for immediate UI feedback on rapid toggles
      // Compute value from current optimistic state (via prev) to avoid stale closure issues
      setLocalOverrides((prev) => {
        const existingOptimistic = prev[memberId]?.[slot];
        const currentValue =
          existingOptimistic !== undefined
            ? String(existingOptimistic ?? "")
            : String(serverVal ?? "");

        previousValue = currentValue || null;

        newValue = toggleMultiSelectValue(currentValue, option) ?? null;
        return { ...prev, [memberId]: { ...prev[memberId], [slot]: newValue } };
      });
      setIsUpdatingField(true);
      try {
        await setCustomFieldMut({
          communityPeopleId: memberId as Id<"communityPeople">,
          field: slot,
          value: newValue || null,
        });
      } catch (err) {
        console.error("[FollowupMobileGrid] multiselect toggle failed:", err);
        // Restore to previous value instead of deleting slot to preserve other in-flight toggles
        setLocalOverrides((prev) => {
          const next = { ...prev };
          if (previousValue) {
            next[memberId] = { ...next[memberId], [slot]: previousValue };
          } else {
            if (next[memberId]) {
              delete next[memberId][slot];
              if (Object.keys(next[memberId]).length === 0)
                delete next[memberId];
            }
          }
          return next;
        });
        Alert.alert("Could not update field", "Please try again.");
      } finally {
        setIsUpdatingField(false);
      }
      // Don't close sheet — allow multiple toggles
    },
    [editSheet, activeEditMember, setCustomFieldMut],
  );

  const handleMultiselectClear = useCallback(async () => {
    if (!editSheet || !editSheet.customField || !activeEditMember) return;
    const { memberId } = editSheet;
    const { slot } = editSheet.customField;
    const serverVal = (activeEditMember as Record<string, unknown>)[slot];

    // Track previous value for rollback - set synchronously within setLocalOverrides
    let previousValue: string | null = null;

    // Optimistic clear
    setLocalOverrides((prev) => {
      const existingOptimistic = prev[memberId]?.[slot];
      const currentValue =
        existingOptimistic !== undefined
          ? String(existingOptimistic ?? "")
          : String(serverVal ?? "");

      previousValue = currentValue || null;

      return { ...prev, [memberId]: { ...prev[memberId], [slot]: null } };
    });
    setEditSheet(null);
    try {
      await setCustomFieldMut({
        communityPeopleId: memberId as Id<"communityPeople">,
        field: slot,
        value: null,
      });
    } catch (err) {
      console.error("[FollowupMobileGrid] multiselect clear failed:", err);
      // Restore to previous value instead of deleting slot to preserve other in-flight toggles
      setLocalOverrides((prev) => {
        const next = { ...prev };
        if (previousValue) {
          next[memberId] = { ...next[memberId], [slot]: previousValue };
        } else {
          if (next[memberId]) {
            delete next[memberId][slot];
            if (Object.keys(next[memberId]).length === 0) delete next[memberId];
          }
        }
        return next;
      });
      Alert.alert("Could not update field", "Please try again.");
    }
  }, [editSheet, activeEditMember, setCustomFieldMut]);

  const handleAssignChange = async (assigneeIds: string[]) => {
    if (!editSheet || !activeEditMember) return;
    const memberId = editSheet.memberId;
    const previousAssigneeOverride = localOverrides[memberId]?.assigneeIds;
    const normalizedAssigneeIds = Array.from(new Set(assigneeIds));

    setIsUpdatingField(true);
    setLocalOverrides((prev) => ({
      ...prev,
      [memberId]: {
        ...prev[memberId],
        assigneeIds: normalizedAssigneeIds,
      },
    }));
    try {
      await setAssigneeMut({
        communityPeopleId: memberId as Id<"communityPeople">,
        assigneeIds: normalizedAssigneeIds as Id<"users">[],
      });
    } catch (error) {
      // Roll back optimistic assignee override on mutation failure.
      setLocalOverrides((prev) => {
        const existing = prev[memberId] ?? {};
        const restored = { ...existing };
        if (previousAssigneeOverride === undefined) {
          delete restored.assigneeIds;
        } else {
          restored.assigneeIds = previousAssigneeOverride;
        }
        if (Object.keys(restored).length === 0) {
          const next = { ...prev };
          delete next[memberId];
          return next;
        }
        return { ...prev, [memberId]: restored };
      });
      console.error("[FollowupMobileGrid] Failed to set assignee:", error);
      Alert.alert("Could not update assignee", "Please try again.");
    } finally {
      setIsUpdatingField(false);
    }
  };

  const handleStatusChange = async (status?: string) => {
    if (!editSheet || !activeEditMember) return;
    const memberId = editSheet.memberId;
    const previousStatusOverride = localOverrides[memberId]?.status;

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
        communityPeopleId: memberId as Id<"communityPeople">,
        status: status ?? null,
      });
      setEditSheet(null);
    } catch (error) {
      // Roll back optimistic status override on mutation failure.
      setLocalOverrides((prev) => {
        const existing = prev[memberId] ?? {};
        const restored = { ...existing };
        if (previousStatusOverride === undefined) {
          delete restored.status;
        } else {
          restored.status = previousStatusOverride;
        }
        if (Object.keys(restored).length === 0) {
          const next = { ...prev };
          delete next[memberId];
          return next;
        }
        return { ...prev, [memberId]: restored };
      });
      console.error("[FollowupMobileGrid] Failed to set status:", error);
      Alert.alert("Could not update status", "Please try again.");
    } finally {
      setIsUpdatingField(false);
    }
  };

  // Track whether we've ever loaded data — once true, never show the full-page
  // loading spinner again (prevents scroll position reset on sort/filter changes)
  const hasEverLoadedRef = useRef(false);
  if (members.length > 0) hasEverLoadedRef.current = true;
  const isInitialLoading =
    ((!hasTextSearch && isLoading && members.length === 0) || isSearchLoading) &&
    !hasEverLoadedRef.current;

  const renderColumnHeader = (column: GridColumn) => {
    const isActiveSort = sortField === column.key;
    return (
      <TouchableOpacity
        key={column.key}
        style={[styles.headerCell, { width: column.width, borderRightColor: colors.border }]}
        disabled={!column.sortable}
        onPress={() => {
          if (column.sortable) handleSortPress(column.key);
        }}
      >
        <Text
          numberOfLines={1}
          style={[
            styles.headerCellText,
            { color: colors.text },
            !column.sortable && { color: colors.textSecondary },
          ]}
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
      const scoreStyles = getScoreStyles(value, colors);
      return (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => {
            setScoreBreakdownSheet({
              memberId: member.groupMemberId,
              memberName: `${member.firstName} ${member.lastName}`.trim(),
              scores: SYSTEM_SCORE_COLUMNS.map((sc) => ({
                id: sc.id,
                name: sc.name,
                slot: sc.slot,
                value: getSystemScoreValue(member, sc.slot) ?? 0,
              })),
            });
          }}
          style={[
            styles.scorePill,
            {
              borderColor: scoreStyles.border,
              backgroundColor: scoreStyles.bg,
            },
          ]}
        >
          <Text style={[styles.scorePillText, { color: scoreStyles.text }]}>
            {value}%
          </Text>
        </TouchableOpacity>
      );
    }

    if (column.kind === "status") {
      const status = typeof value === "string" ? value : "none";
      const statusStyles = getStatusStyles(status, colors);
      const label =
        status === "none"
          ? "None"
          : `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
      return (
        <View style={[styles.statusPill, { backgroundColor: statusStyles.bg }]}>
          <Text style={[styles.statusPillText, { color: statusStyles.text }]}>
            {label}
          </Text>
        </View>
      );
    }

    if (
      column.kind === "boolean" &&
      column.editable === "custom" &&
      column.customField
    ) {
      const cf = column.customField;
      return (
        <TouchableOpacity
          onPress={async () => {
            const raw = (member as Record<string, unknown>)[cf.slot];
            await handleCustomFieldSave(member.groupMemberId, cf.slot, !raw);
          }}
          disabled={isUpdatingField}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons
            name={value ? "checkbox" : "square-outline"}
            size={18}
            color={value ? primaryColor : colors.iconSecondary}
          />
        </TouchableOpacity>
      );
    }

    if (column.kind === "boolean") {
      return (
        <Ionicons
          name={value ? "checkbox" : "square-outline"}
          size={16}
          color={value ? primaryColor : colors.iconSecondary}
        />
      );
    }

    if (
      column.kind === "multiselect" &&
      column.editable === "custom" &&
      column.customField
    ) {
      const cf = column.customField;
      const rawValue = String(value ?? "");
      const options = selectOptionsBySlot.get(cf.slot) ?? [];
      const hasOptions = options.length > 0;
      const selectedValues = parseMultiSelectValues(rawValue);
      return (
        <TouchableOpacity
          style={styles.editableCell}
          activeOpacity={0.7}
          disabled={!hasOptions}
          onPress={() => {
            if (!hasOptions) return;
            setEditSheet({
              type: "customMultiselect",
              memberId: member.groupMemberId,
              customField: cf,
              initialValue: rawValue,
            });
          }}
        >
          {selectedValues.length > 0 ? (
            <View style={styles.multiselectChipRow}>
              {selectedValues.slice(0, 2).map((v) => (
                <View key={v} style={[styles.multiselectChip, { backgroundColor: colors.surfaceSecondary }]}>
                  <Text style={[styles.multiselectChipText, { color: colors.link }]} numberOfLines={1}>
                    {v}
                  </Text>
                </View>
              ))}
              {selectedValues.length > 2 && (
                <Text style={[styles.multiselectMoreText, { color: colors.link }]}>
                  +{selectedValues.length - 2}
                </Text>
              )}
            </View>
          ) : (
            <Text
              style={[styles.dataCellText, { color: colors.textTertiary, fontStyle: 'italic' as const }]}
              numberOfLines={1}
            >
              {hasOptions ? "Select…" : "No options configured"}
            </Text>
          )}
          {hasOptions && (
            <Ionicons
              name="chevron-down"
              size={11}
              color={colors.icon}
              style={styles.editIcon}
            />
          )}
        </TouchableOpacity>
      );
    }

    if (
      (column.kind === "text" ||
        column.kind === "dropdown" ||
        column.kind === "number") &&
      column.editable === "custom" &&
      column.customField
    ) {
      const cf = column.customField;
      const displayVal = String(value);
      const isDropdown = cf.type === "dropdown";
      const dropdownOptions = isDropdown
        ? (selectOptionsBySlot.get(cf.slot) ?? [])
        : [];
      const hasDropdownOptions = !isDropdown || dropdownOptions.length > 0;
      return (
        <TouchableOpacity
          style={styles.editableCell}
          activeOpacity={0.7}
          disabled={!hasDropdownOptions}
          onPress={() => {
            if (!hasDropdownOptions) return;
            setEditSheet({
              type: isDropdown ? "customDropdown" : "customText",
              memberId: member.groupMemberId,
              customField: cf,
              initialValue: displayVal,
            });
            setCustomFieldInput(displayVal);
          }}
        >
          <Text
            style={[
              styles.dataCellText,
              { color: colors.text },
              !displayVal && { color: colors.textTertiary, fontStyle: 'italic' as const },
            ]}
            numberOfLines={1}
          >
            {displayVal || (isDropdown
              ? (hasDropdownOptions ? "Select…" : "No options configured")
              : "Tap to add")}
          </Text>
          {hasDropdownOptions && (
            <Ionicons
              name="chevron-down"
              size={11}
              color={colors.icon}
              style={styles.editIcon}
            />
          )}
        </TouchableOpacity>
      );
    }

    return (
      <Text style={[styles.dataCellText, { color: colors.text }]} numberOfLines={1}>
        {String(value)}
      </Text>
    );
  };

  const syncingScrollRef = useRef(false);
  const leftListRef = useRef<FlatList>(null);
  const rightListRef = useRef<FlatList>(null);

  const handleScrollSync = useCallback(
    (source: "left" | "right") =>
      ({ nativeEvent }: { nativeEvent: { contentOffset: { y: number } } }) => {
        if (syncingScrollRef.current) return;
        const y = nativeEvent.contentOffset.y;
        syncingScrollRef.current = true;
        if (source === "left") {
          rightListRef.current?.scrollToOffset({ offset: y, animated: false });
        } else {
          leftListRef.current?.scrollToOffset({ offset: y, animated: false });
        }
        requestAnimationFrame(() => {
          syncingScrollRef.current = false;
        });
      },
    [],
  );

  const renderMemberRowLeft = ({ item }: { item: FollowupMember }) => {
    const subtitleLine =
      getMemberSubtitleLines(item)[0] ?? "No recent activity details";
    const hasAlerts = (item.alerts?.length ?? 0) > 0;
    const isSnoozed =
      item.isSnoozed && !!item.snoozedUntil && item.snoozedUntil > Date.now();
    const isSelected = selectedIds.has(item.groupMemberId);

    return (
      <View
        style={[
          styles.row,
          { borderBottomColor: colors.borderLight, backgroundColor: colors.background },
          hasAlerts && { backgroundColor: colors.warning },
          isSnoozed && styles.rowSnoozed,
          isSelected && { backgroundColor: colors.selectedBackground },
        ]}
      >
        <TouchableOpacity
          style={[styles.selectCell, { width: SELECT_COL_WIDTH, borderRightColor: colors.border }]}
          activeOpacity={0.7}
          onPress={() => handleToggleSelect(item.groupMemberId)}
        >
          <Ionicons
            name={isSelected ? "checkbox" : "square-outline"}
            size={18}
            color={isSelected ? primaryColor : colors.iconSecondary}
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.memberCell, { width: MEMBER_COL_WIDTH, borderRightColor: colors.border }]}
          activeOpacity={0.8}
          onPress={() =>
            handleMemberPress(
              item.groupMemberId,
              (item as any).groupId?.toString(),
            )
          }
        >
          {item.avatarUrl ? (
            <Image
              source={{ uri: item.avatarUrl }}
              style={styles.avatarImage}
            />
          ) : (
            <View style={[styles.avatarFallback, { backgroundColor: primaryColor }]}>
              <Text style={[styles.avatarFallbackText, { color: '#fff' }]}>
                {item.firstName?.[0]?.toUpperCase() ?? "?"}
              </Text>
            </View>
          )}

          <View style={styles.memberTextWrap}>
            <Text style={[styles.memberName, { color: colors.text }]} numberOfLines={1}>
              {item.firstName} {item.lastName}
            </Text>
            <Text style={[styles.memberSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
              {subtitleLine}
            </Text>
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  const renderMemberRowRight = ({ item }: { item: FollowupMember }) => {
    const hasAlerts = (item.alerts?.length ?? 0) > 0;
    const isSnoozed =
      item.isSnoozed && !!item.snoozedUntil && item.snoozedUntil > Date.now();
    const isSelected = selectedIds.has(item.groupMemberId);

    return (
      <View
        style={[
          styles.row,
          { borderBottomColor: colors.borderLight, backgroundColor: colors.background },
          hasAlerts && { backgroundColor: colors.warning },
          isSnoozed && styles.rowSnoozed,
          isSelected && { backgroundColor: colors.selectedBackground },
        ]}
      >
        <View style={styles.rowDataCells}>
          {dataColumns.map((column) => {
            const isEditable =
              column.editable === "assignee" || column.editable === "status";
            if (!isEditable) {
              return (
                <View
                  key={`${item.groupMemberId}-${column.key}`}
                  style={[styles.dataCell, { width: column.width, borderRightColor: colors.borderLight }]}
                >
                  {renderDataCell(item, column)}
                </View>
              );
            }

            return (
              <TouchableOpacity
                key={`${item.groupMemberId}-${column.key}`}
                style={[
                  styles.dataCell,
                  styles.editableCell,
                  { width: column.width, borderRightColor: colors.borderLight },
                ]}
                activeOpacity={0.7}
                onPress={() => {
                  setEditSheet({
                    type:
                      column.editable === "assignee" ? "assignee" : "status",
                    memberId: item.groupMemberId,
                  });
                }}
              >
                {renderDataCell(item, column)}
                <Ionicons
                  name="chevron-down"
                  size={11}
                  color={colors.icon}
                  style={styles.editIcon}
                />
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  };

  if (isInitialLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={primaryColor} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading people list...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.backgroundSecondary }]}>
      <View style={[styles.header, { paddingTop: insets.top + 14, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <View style={styles.headerTopRow}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={handleBack}
            testID="back-button"
          >
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerContent}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>{toolDisplayName}</Text>
            <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
              {groupData?.name || "Group"}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.headerAddButton}
            onPress={() => setShowQuickAddModal(true)}
          >
            <Ionicons name="person-add-outline" size={20} color={colors.success} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.settingsButton}
            onPress={handleSettingsPress}
          >
            <Ionicons name="settings-outline" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <View style={[styles.searchRow, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
          <Ionicons
            name="search"
            size={16}
            color={colors.icon}
            style={styles.searchIcon}
          />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={[styles.searchInput, { color: colors.text }]}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setTimeout(() => setIsSearchFocused(false), 120)}
            placeholder="Search, -assignee:bob, date added:<12/14/25"
            placeholderTextColor={colors.iconSecondary}
            testID="followup-mobile-search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearchQuery("")}
              style={styles.clearSearchButton}
            >
              <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
          )}
        </View>
        {searchHelperText && (
          <Text style={[styles.searchHelperText, { color: colors.textSecondary }]}>{searchHelperText}</Text>
        )}
        {showSearchSuggestions && (
          <View style={[styles.searchSuggestionBox, { borderColor: colors.border, backgroundColor: colors.background }]}>
            {searchSuggestions.map((suggestion) => (
              <TouchableOpacity
                key={suggestion.id}
                style={[styles.searchSuggestionRow, { borderBottomColor: colors.borderLight }]}
                onPress={() => {
                  setSearchQuery(
                    applyFollowupSuggestion(searchQuery, suggestion.insertText),
                  );
                  setIsSearchFocused(false);
                }}
              >
                <Text style={[styles.searchSuggestionLabel, { color: colors.text }]}>
                  {suggestion.label}
                </Text>
                <Text style={[styles.searchSuggestionHelp, { color: colors.textSecondary }]}>
                  {suggestion.helperText}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {activeFilterBadges.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterBadgeRow}
          >
            {activeFilterBadges.map((badge, index) => (
              <View key={`${badge}-${index}`} style={[styles.filterBadge, { backgroundColor: colors.surfaceSecondary }]}>
                <Text style={[styles.filterBadgeText, { color: colors.link }]}>{badge}</Text>
              </View>
            ))}
          </ScrollView>
        )}

        <Text style={[styles.resultMeta, { color: colors.textSecondary }]}>
          Showing {displayMembers.length}
          {typeof totalCount === "number" ? ` of ${totalCount}` : ""}
          {hasStructuredFilters || hasTextSearch ? " (filtered)" : ""}
          {(isSearchLoading || (!hasTextSearch && isLoading)) &&
          displayMembers.length > 0
            ? " …"
            : ""}
        </Text>
      </View>

      {groupData?.communityId && (
        <PeopleViewBar
          communityId={groupData.communityId}
          activeViewId={activeViewId}
          onViewSelect={(viewId, view) => {
            if (view?.isSpecial) {
              setActiveViewId(viewId);
              return;
            }
            setActiveViewId(viewId);
            if (view.sortBy) setSortField(view.sortBy);
            if (view.sortDirection) setSortDirection(view.sortDirection);
            // Apply filters as search query
            const filterParts: string[] = [];
            if (view.filters?.statusFilter) filterParts.push(`status:${view.filters.statusFilter}`);
            if (view.filters?.assigneeFilter) {
              const leader = leaderMap.get(view.filters.assigneeFilter);
              if (leader) filterParts.push(`assignee:${leader.firstName}`);
            }
            if (view.filters?.scoreField && view.filters?.scoreMin !== undefined) {
              filterParts.push(`${view.filters.scoreField}:>${view.filters.scoreMin}`);
            }
            if (view.filters?.scoreField && view.filters?.scoreMax !== undefined) {
              filterParts.push(`${view.filters.scoreField}:<${view.filters.scoreMax}`);
            }
            setSearchQuery(filterParts.join(" "));
          }}
          onViewDeselect={() => {
            if (activeViewId === FOLLOWUP_MAP_VIEW_ID) {
              setActiveViewId(null);
              return;
            }
            setActiveViewId(null);
            setSortField("score3");
            setSortDirection("asc");
            setSearchQuery("");
          }}
          onDeleteView={(viewId, viewName, isShared) => {
            setViewToDelete({ id: viewId, name: viewName, isShared });
          }}
          onCreateView={() => setShowSaveViewModal(true)}
          isAdmin={groupData?.userRole === "admin"}
          specialViews={[{ id: FOLLOWUP_MAP_VIEW_ID, name: "Map", icon: "map-outline" }]}
        />
      )}

      <View style={styles.gridContainer}>
        {selectedIds.size > 0 && !isMapViewActive && (
          <View style={[styles.actionBar, { backgroundColor: colors.selectedBackground, borderColor: colors.link }]}>
            <View style={styles.actionBarLeft}>
              <Text style={[styles.actionBarCount, { color: colors.link }]}>
                {selectedIds.size} selected
              </Text>
              <TouchableOpacity onPress={() => setSelectedIds(new Set())}>
                <Text style={[styles.actionBarDeselect, { color: colors.link }]}>Deselect all</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.actionBarRemoveButton, { backgroundColor: colors.destructive }]}
              onPress={() => setShowRemoveModal(true)}
            >
              <Ionicons name="trash-outline" size={14} color={colors.textInverse} />
              <Text style={[styles.actionBarRemoveText, { color: '#fff' }]}>Remove from group</Text>
            </TouchableOpacity>
          </View>
        )}

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
            loading={isInitialLoading}
            onOpenMember={(memberId) => {
              router.push(
                `/(user)/leader-tools/${groupId}/followup/${memberId}`,
              );
            }}
          />
        ) : (
        <View style={styles.pinnedGridWrapper}>
          <View style={[styles.pinnedLeft, { width: pinnedWidth, borderColor: colors.border, backgroundColor: colors.background }]}>
            <View style={[styles.headerRow, { borderBottomColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
              <TouchableOpacity
                style={[styles.selectHeaderCell, { width: SELECT_COL_WIDTH, borderRightColor: colors.border }]}
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
                  color={selectedIds.size > 0 ? primaryColor : colors.iconSecondary}
                />
              </TouchableOpacity>
              <View
                style={[styles.memberHeaderCell, { width: MEMBER_COL_WIDTH, borderRightColor: colors.border }]}
              >
                <Text style={[styles.memberHeaderText, { color: colors.text }]}>Member</Text>
              </View>
            </View>
            <FlatList
              ref={leftListRef}
              data={displayMembers}
              style={styles.tableList}
              extraData={flatListExtraData}
              keyExtractor={(item) => item._id || item.groupMemberId}
              renderItem={renderMemberRowLeft}
              onScroll={handleScrollSync("left")}
              scrollEventThrottle={16}
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
                  <Ionicons name="search-outline" size={42} color={colors.iconSecondary} />
                  <Text style={[styles.emptyTitle, { color: colors.text }]}>No matches</Text>
                  <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                    {hasTextSearch || hasStructuredFilters
                      ? "No members match your search and filters."
                      : "No members to show right now."}
                  </Text>
                </View>
              }
              contentContainerStyle={[styles.listContent, { backgroundColor: colors.background }]}
            />
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator
            style={styles.scrollableRight}
            contentContainerStyle={styles.gridScrollContent}
          >
            <View style={[styles.tableContainer, { width: dataColumnsWidth, borderColor: colors.border, backgroundColor: colors.background }]}>
              <View style={[styles.headerRow, { borderBottomColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
                <View style={[styles.headerDataCells, { backgroundColor: colors.surfaceSecondary }]}>
                  {dataColumns.map(renderColumnHeader)}
                </View>
              </View>
              <FlatList
                ref={rightListRef}
                data={displayMembers}
                style={styles.tableList}
                extraData={flatListExtraData}
                keyExtractor={(item) => item._id || item.groupMemberId}
                renderItem={renderMemberRowRight}
                onScroll={handleScrollSync("right")}
                scrollEventThrottle={16}
                ListFooterComponent={
                  !hasTextSearch && paginationStatus === "LoadingMore" ? (
                    <View style={styles.footerLoading}>
                      <ActivityIndicator size="small" color={primaryColor} />
                    </View>
                  ) : null
                }
                ListEmptyComponent={null}
                contentContainerStyle={[styles.listContent, { backgroundColor: colors.background }]}
              />
            </View>
          </ScrollView>
        </View>
        )}
      </View>

      <Modal
        visible={showQuickAddModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowQuickAddModal(false)}
      >
        <View style={[styles.quickAddBackdrop, { backgroundColor: colors.overlay }]}>
          <View style={[styles.quickAddCard, { backgroundColor: colors.modalBackground }]}>
            <FollowupQuickAddPanel
              groupId={groupId}
              customFields={customFields}
              leaderOptions={leaderOptions}
              primaryColor={primaryColor}
              onCancel={() => setShowQuickAddModal(false)}
              onCreated={({ groupMemberId }) => {
                setShowQuickAddModal(false);
                router.push(`/(user)/leader-tools/${groupId}/followup/${groupMemberId}`);
              }}
            />
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!editSheet}
        transparent
        animationType="fade"
        onRequestClose={closeEditSheet}
      >
        <Pressable style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]} onPress={closeEditSheet}>
          <Pressable style={[styles.editSheetCard, { backgroundColor: colors.modalBackground }]} onPress={() => undefined}>
            <Text style={[styles.editSheetTitle, { color: colors.text }]}>
              {editSheet?.type === "assignee"
                ? "Update assignees"
                : editSheet?.type === "status"
                  ? "Update status"
                  : editSheet?.type === "customText"
                    ? `Edit ${editSheet.customField?.name ?? "field"}`
                    : editSheet?.type === "customDropdown"
                      ? `Select ${editSheet.customField?.name ?? "option"}`
                      : editSheet?.type === "customMultiselect"
                        ? `Select ${editSheet.customField?.name ?? "options"}`
                        : "Edit"}
            </Text>
            <Text style={[styles.editSheetSubtitle, { color: colors.textSecondary }]}>
              {activeEditMember
                ? `${activeEditMember.firstName} ${activeEditMember.lastName}`
                : "Member"}
            </Text>

            {editSheet?.type === "customText" ? (
              <View style={styles.customFieldEditRow}>
                <TextInput
                  style={[styles.customFieldInput, { borderColor: colors.inputBorder, color: colors.text }]}
                  value={customFieldInput}
                  onChangeText={setCustomFieldInput}
                  placeholder={`Enter ${editSheet.customField?.name ?? "value"}...`}
                  placeholderTextColor={colors.iconSecondary}
                  autoFocus
                  onSubmitEditing={handleCustomTextSubmit}
                  returnKeyType="done"
                  keyboardType={
                    editSheet.customField?.type === "number"
                      ? "numeric"
                      : "default"
                  }
                />
                <TouchableOpacity
                  style={[
                    styles.customFieldSaveButton,
                    { backgroundColor: primaryColor },
                  ]}
                  onPress={handleCustomTextSubmit}
                  disabled={isUpdatingField}
                >
                  <Text style={[styles.customFieldSaveButtonText, { color: '#fff' }]}>Save</Text>
                </TouchableOpacity>
              </View>
            ) : editSheet?.type === "customDropdown" ? (
              <ScrollView style={styles.optionList}>
                {(selectOptionsBySlot.get(editSheet.customField?.slot ?? "") ?? []).length > 0 ? (
                  <>
                    {(selectOptionsBySlot.get(editSheet.customField?.slot ?? "") ?? []).map((opt) => (
                      <TouchableOpacity
                        key={opt}
                        style={[
                          styles.optionRow,
                          { borderTopColor: colors.borderLight },
                          (activeEditMember as Record<string, unknown>)?.[
                            editSheet!.customField!.slot
                          ] === opt && { backgroundColor: colors.selectedBackground },
                        ]}
                        onPress={() => handleCustomDropdownSelect(opt)}
                        disabled={isUpdatingField}
                      >
                        <Text style={[styles.optionText, { color: colors.text }]}>{opt}</Text>
                        {(activeEditMember as Record<string, unknown>)?.[
                          editSheet!.customField!.slot
                        ] === opt && (
                          <Ionicons
                            name="checkmark"
                            size={16}
                            color={primaryColor}
                          />
                        )}
                      </TouchableOpacity>
                    ))}
                  </>
                ) : (
                  <View style={[styles.optionRow, { borderTopColor: colors.borderLight }]}>
                    <Text style={[styles.optionText, { color: colors.text }]}>No options configured</Text>
                  </View>
                )}
                {String(
                  (activeEditMember as Record<string, unknown>)?.[
                    editSheet!.customField!.slot
                  ] ?? ""
                ).trim().length > 0 && (
                  <TouchableOpacity
                    style={[styles.optionRow, { borderTopColor: colors.borderLight }]}
                    onPress={() => handleCustomDropdownSelect(undefined)}
                    disabled={isUpdatingField}
                  >
                    <Text style={[styles.optionText, { color: colors.text }]}>Clear</Text>
                  </TouchableOpacity>
                )}
              </ScrollView>
            ) : editSheet?.type === "customMultiselect" ? (
              <ScrollView style={styles.optionList}>
                {(selectOptionsBySlot.get(editSheet.customField?.slot ?? "") ?? []).length > 0 ? (
                  <>
                    {(selectOptionsBySlot.get(editSheet.customField?.slot ?? "") ?? []).map((opt) => {
                      const currentVal = (
                        activeEditMember as Record<string, unknown>
                      )?.[editSheet!.customField!.slot];
                      const selectedValues = parseMultiSelectValues(
                        currentVal ? String(currentVal) : ""
                      );
                      const isChecked = selectedValues.includes(opt);
                      return (
                        <TouchableOpacity
                          key={opt}
                          style={[
                            styles.optionRow,
                            { borderTopColor: colors.borderLight },
                            isChecked && { backgroundColor: colors.selectedBackground },
                          ]}
                          onPress={() => handleMultiselectToggle(opt)}
                          disabled={isUpdatingField}
                        >
                          <View style={styles.multiselectOptionRow}>
                            <Ionicons
                              name={isChecked ? "checkbox" : "square-outline"}
                              size={20}
                              color={isChecked ? primaryColor : colors.iconSecondary}
                              style={styles.multiselectCheckboxIcon}
                            />
                            <Text style={[styles.optionText, { color: colors.text }]}>{opt}</Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </>
                ) : (
                  <View style={[styles.optionRow, { borderTopColor: colors.borderLight }]}>
                    <Text style={[styles.optionText, { color: colors.text }]}>No options configured</Text>
                  </View>
                )}
                {parseMultiSelectValues(
                  String(
                    (activeEditMember as Record<string, unknown>)?.[
                      editSheet!.customField!.slot
                    ] ?? ""
                  )
                ).length > 0 && (
                  <TouchableOpacity
                    style={[styles.optionRow, { borderTopColor: colors.borderLight }]}
                    onPress={handleMultiselectClear}
                    disabled={isUpdatingField}
                  >
                    <Text style={[styles.optionText, { color: colors.text }]}>Clear all</Text>
                  </TouchableOpacity>
                )}
              </ScrollView>
            ) : editSheet?.type === "assignee" ? (
              <ScrollView style={styles.optionList}>
                {leaderOptions.map((leader) => {
                  const selectedAssigneeIds = activeEditMember
                    ? getAssigneeIds(activeEditMember)
                    : [];
                  const isSelected = selectedAssigneeIds.includes(leader.id);
                  return (
                    <TouchableOpacity
                      key={leader.id}
                      style={[
                        styles.optionRow,
                        { borderTopColor: colors.borderLight },
                        isSelected && { backgroundColor: colors.selectedBackground },
                      ]}
                      onPress={() => {
                        const nextAssigneeIds = isSelected
                          ? selectedAssigneeIds.filter((id) => id !== leader.id)
                          : [...selectedAssigneeIds, leader.id];
                        handleAssignChange(nextAssigneeIds);
                      }}
                      disabled={isUpdatingField}
                    >
                      <Text style={[styles.optionText, { color: colors.text }]}>
                        {leader.firstName} {leader.lastName}
                      </Text>
                      {isSelected && (
                        <Ionicons
                          name="checkmark"
                          size={16}
                          color={primaryColor}
                        />
                      )}
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity
                  style={[styles.optionRow, { borderTopColor: colors.borderLight }]}
                  onPress={() => handleAssignChange([])}
                  disabled={isUpdatingField}
                >
                  <Text style={[styles.optionText, { color: colors.text }]}>Clear all assignees</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.optionRow, { borderTopColor: colors.borderLight }]}
                  onPress={() => setEditSheet(null)}
                  disabled={isUpdatingField}
                >
                  <Text style={[styles.optionText, { color: colors.text }]}>Done</Text>
                </TouchableOpacity>
              </ScrollView>
            ) : (
              <View style={styles.optionList}>
                {STATUS_OPTIONS.map((option) => {
                  const isSelected =
                    (activeEditMember?.status ?? undefined) === option.value;
                  return (
                    <TouchableOpacity
                      key={option.label}
                      style={[
                        styles.optionRow,
                        { borderTopColor: colors.borderLight },
                        isSelected && { backgroundColor: colors.selectedBackground },
                      ]}
                      onPress={() => handleStatusChange(option.value)}
                      disabled={isUpdatingField}
                    >
                      <Text style={[styles.optionText, { color: colors.text }]}>{option.label}</Text>
                      {isSelected && (
                        <Ionicons
                          name="checkmark"
                          size={16}
                          color={primaryColor}
                        />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>

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

      {/* Save view modal */}
      {groupData?.communityId && (
        <SaveViewModal
          visible={showSaveViewModal}
          onClose={() => setShowSaveViewModal(false)}
          communityId={groupData.communityId}
          currentSortBy={sortField}
          currentSortDirection={sortDirection}
          currentFilters={saveViewFilters}
          isAdmin={groupData?.userRole === "admin"}
        />
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
          }
          await deleteViewMut({ viewId: viewToDelete.id as Id<"peopleSavedViews"> });
          setViewToDelete(null);
        }}
        onCancel={() => setViewToDelete(null)}
        confirmText="Delete"
        destructive
      />

      {/* Score Breakdown Modal */}
      <Modal
        visible={!!scoreBreakdownSheet}
        transparent
        animationType="fade"
        onRequestClose={() => setScoreBreakdownSheet(null)}
      >
        <Pressable
          style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}
          onPress={() => setScoreBreakdownSheet(null)}
        >
          <Pressable
            style={[styles.scoreBreakdownCard, { backgroundColor: colors.modalBackground }]}
            onPress={() => undefined}
          >
            <View style={styles.scoreBreakdownHeader}>
              <Text style={[styles.editSheetTitle, { color: colors.text }]}>
                Score Breakdown
              </Text>
              <TouchableOpacity onPress={() => setScoreBreakdownSheet(null)}>
                <Ionicons name="close" size={22} color={colors.icon} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.editSheetSubtitle, { color: colors.textSecondary }]}>
              {scoreBreakdownSheet?.memberName}
            </Text>

            <ScrollView style={styles.scoreBreakdownScroll}>
              {scoreBreakdownSheet?.scores.map((score) => {
                const scoreColor = score.value >= 70
                  ? colors.success
                  : score.value >= 40
                    ? colors.warning
                    : colors.destructive;
                const description = score.id === "sys_togather"
                  ? "Measures how well leaders are connecting with this person. Use this to triage who needs outreach \u2014 lower scores mean someone needs attention."
                  : score.id === "sys_attendance"
                    ? "Percentage of weeks with at least one attendance across all groups in the last 60 days."
                    : "Serving frequency from Planning Center in the past 2 months. 20 points per service, max 100.";
                const formula = score.id === "sys_togather"
                  ? "Attendance (up to 70 pts):\nEach missed week deducts 15 pts from a perfect attendance score. Only weeks that had meetings count \u2014 weeks with no events don\u2019t count against anyone.\n\nExample: 2 missed weeks = 70 pts lost \u2192 attendance portion is 49 out of 70.\n\nFollow-up (fills the rest):\nThe remaining points (up to 100) are filled by the most recent follow-up:\n\u2022 In-person visit \u2192 fills 100% of remaining\n\u2022 Phone call \u2192 fills 75%\n\u2022 Text message \u2192 fills 50%\n\nFollow-ups fade over time. In-person lasts ~100 days, calls ~85 days, texts ~70 days. If someone has zero attendance, follow-ups fade twice as fast.\n\nThe less someone attends, the more follow-up matters. Someone who never attends but was visited today still scores 100."
                  : score.id === "sys_attendance"
                    ? "Weeks attended out of total weeks in the last 60 days.\nAdjusted for join date \u2014 new members aren\u2019t penalized for weeks before they joined."
                    : "20 points per service in the past 2 months, up to 100.\nBased on Planning Center serving data.";

                return (
                  <View key={score.id} style={[styles.scoreBreakdownItem, { borderColor: colors.borderLight }]}>
                    <View style={styles.scoreBreakdownItemHeader}>
                      <Text style={[styles.scoreBreakdownScoreName, { color: colors.text }]}>
                        {score.name}
                      </Text>
                      <View style={[styles.scoreBreakdownBadge, { backgroundColor: scoreColor }]}>
                        <Text style={styles.scoreBreakdownBadgeText}>{score.value}%</Text>
                      </View>
                    </View>
                    <Text style={[styles.scoreBreakdownDescription, { color: colors.textSecondary }]}>
                      {description}
                    </Text>
                    <View style={[styles.scoreBreakdownFormulaBox, { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderLight }]}>
                      <Text style={[styles.scoreBreakdownFormulaLabel, { color: colors.textTertiary }]}>
                        How it works
                      </Text>
                      <Text style={[styles.scoreBreakdownFormula, { color: colors.text }]}>
                        {formula}
                      </Text>
                    </View>
                    <View style={[styles.scoreBreakdownBar, { backgroundColor: colors.borderLight }]}>
                      <View style={[styles.scoreBreakdownBarFill, { width: `${Math.max(2, score.value)}%`, backgroundColor: scoreColor }]} />
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 10,
  },
  header: {
    paddingHorizontal: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
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
  },
  headerSubtitle: {
    marginTop: 2,
    fontSize: 13,
  },
  settingsButton: {
    padding: 6,
  },
  headerAddButton: {
    padding: 6,
    marginRight: 6,
  },
  searchRow: {
    marginTop: 12,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
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
    paddingVertical: 0,
  },
  clearSearchButton: {
    marginLeft: 6,
  },
  searchHelperText: {
    marginTop: 6,
    fontSize: 11,
  },
  searchSuggestionBox: {
    marginTop: 6,
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
    fontWeight: "600",
  },
  searchSuggestionHelp: {
    marginTop: 2,
    fontSize: 11,
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
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  sortChipActive: {},
  sortChipText: {
    fontSize: 12,
    fontWeight: "600",
  },
  sortChipTextActive: {},
  filterBadgeRow: {
    marginTop: 8,
    gap: 6,
    flexDirection: "row",
    alignItems: "center",
  },
  filterBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  filterBadgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
  resultMeta: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: "500",
  },
  gridContainer: {
    flex: 1,
    paddingTop: 8,
  },
  pinnedGridWrapper: {
    flex: 1,
    flexDirection: "row",
  },
  pinnedLeft: {
    borderWidth: 1,
    borderRightWidth: 0,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
    overflow: "hidden",
  },
  scrollableRight: {
    flex: 1,
  },
  gridScrollContent: {
    paddingHorizontal: 10,
    paddingBottom: 12,
  },
  tableContainer: {
    borderWidth: 1,
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
    overflow: "hidden",
  },
  tableList: {
    maxHeight: "100%",
  },
  actionBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginHorizontal: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderRadius: 8,
  },
  actionBarLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  actionBarCount: {
    fontSize: 12,
    fontWeight: "700",
  },
  actionBarDeselect: {
    fontSize: 12,
    textDecorationLine: "underline",
  },
  actionBarRemoveButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  actionBarRemoveText: {
    fontSize: 12,
    fontWeight: "700",
  },
  headerRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
  },
  selectHeaderCell: {
    height: 40,
    borderRightWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  memberHeaderCell: {
    borderRightWidth: 1,
    justifyContent: "center",
    paddingHorizontal: 8,
    height: 40,
  },
  memberHeaderText: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  headerDataCells: {
    flexDirection: "row",
  },
  headerCell: {
    height: 40,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    borderRightWidth: 1,
  },
  headerCellText: {
    fontSize: 11,
    fontWeight: "700",
  },
  headerCellTextMuted: {},
  headerSortIcon: {
    marginLeft: 4,
  },
  listContent: {
    borderBottomWidth: 0,
    paddingBottom: 88,
  },
  row: {
    flexDirection: "row",
    minHeight: 56,
    borderBottomWidth: 1,
  },
  rowAlert: {},
  rowSnoozed: {
    opacity: 0.66,
  },
  rowSelected: {},
  selectCell: {
    borderRightWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  memberCell: {
    borderRightWidth: 1,
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
    alignItems: "center",
    justifyContent: "center",
  },
  avatarFallbackText: {
    fontWeight: "700",
    fontSize: 11,
  },
  memberTextWrap: {
    flex: 1,
  },
  memberName: {
    fontSize: 13,
    fontWeight: "700",
  },
  memberSubtitle: {
    marginTop: 2,
    fontSize: 10,
  },
  groupNameBadge: {
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 4,
  },
  rowDataCells: {
    flexDirection: "row",
  },
  dataCell: {
    minHeight: 48,
    borderRightWidth: 1,
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
    fontWeight: "500",
  },
  customFieldEditRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  customFieldInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  customFieldSaveButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    justifyContent: "center",
  },
  customFieldSaveButtonText: {
    fontSize: 14,
    fontWeight: "600",
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
    fontWeight: "700",
  },
  emptyText: {
    marginTop: 6,
    fontSize: 13,
    textAlign: "center",
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  quickAddBackdrop: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  quickAddCard: {
    borderRadius: 12,
    overflow: "hidden",
    maxHeight: "92%",
  },
  editSheetCard: {
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
    paddingHorizontal: 16,
  },
  editSheetSubtitle: {
    marginTop: 2,
    marginBottom: 8,
    fontSize: 13,
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
  },
  optionText: {
    fontSize: 14,
  },
  multiselectChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 3,
    alignItems: "center",
    flex: 1,
  },
  multiselectChip: {
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    maxWidth: 60,
  },
  multiselectChipText: {
    fontSize: 10,
    fontWeight: "600",
  },
  multiselectMoreText: {
    fontSize: 10,
    fontWeight: "600",
  },
  multiselectOptionRow: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  multiselectCheckboxIcon: {
    marginRight: 10,
  },
  scoreBreakdownCard: {
    borderRadius: 14,
    maxHeight: "85%",
    paddingVertical: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
    width: "92%",
    maxWidth: 420,
  },
  scoreBreakdownHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    marginBottom: 2,
  },
  scoreBreakdownScroll: {
    paddingHorizontal: 16,
    marginTop: 8,
  },
  scoreBreakdownItem: {
    borderBottomWidth: 1,
    paddingBottom: 14,
    marginBottom: 14,
  },
  scoreBreakdownItemHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  scoreBreakdownScoreName: {
    fontSize: 15,
    fontWeight: "700",
  },
  scoreBreakdownBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  scoreBreakdownBadgeText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  scoreBreakdownDescription: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 8,
  },
  scoreBreakdownFormulaBox: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
    marginBottom: 8,
  },
  scoreBreakdownFormulaLabel: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  scoreBreakdownFormula: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "monospace",
  },
  scoreBreakdownBar: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  scoreBreakdownBarFill: {
    height: "100%",
    borderRadius: 3,
  },
});
