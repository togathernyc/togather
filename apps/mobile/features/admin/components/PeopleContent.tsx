/**
 * PeopleContent - Content component for community members management.
 *
 * Displays a searchable, filterable list of community members with infinite scroll.
 * Used within AdminScreen's segmented control.
 */

import React, { useState, useMemo, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
  Image,
  TextInput,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { NotificationsDisabledBadge } from "@components/ui/NotificationsDisabledBadge";

// Type for transformed community member (snake_case for compatibility)
interface CommunityMember {
  user_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  profile_photo: string | null;
  is_admin: boolean;
  is_primary_admin: boolean;
  notifications_disabled: boolean;
}

const PAGE_SIZE = 50;

export function PeopleContent() {
  const router = useRouter();
  const { primaryColor } = useCommunityTheme();
  const { colors, isDark } = useTheme();
  const { user, community, token } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState<string | undefined>(undefined);
  const [showGroupFilter, setShowGroupFilter] = useState(false);

  // Debounced search - automatically triggers after user stops typing
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce search query (400ms delay for smooth UX with fast search)
  React.useEffect(() => {
    const trimmed = searchQuery.trim();
    if (trimmed === debouncedSearch) return;

    const timer = setTimeout(() => {
      setDebouncedSearch(trimmed);
    }, 400);

    return () => clearTimeout(timer);
  }, [searchQuery, debouncedSearch]);

  // Track current page for pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [allMembers, setAllMembers] = useState<CommunityMember[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Track if this is the initial mount (to avoid resetting on first render)
  const isInitialMount = useRef(true);

  // Search results via query (reactive)
  const searchData = useQuery(
    api.functions.admin.members.searchCommunityMembers,
    community?.id && token && debouncedSearch
      ? {
          token,
          communityId: community.id as Id<"communities">,
          search: debouncedSearch,
          limit: 100,
        }
      : "skip"
  );

  // Fetch community members using Convex (for browsing, not searching)
  const membersData = useQuery(
    api.functions.admin.members.listCommunityMembers,
    community?.id && token && !debouncedSearch // Don't use query when searching
      ? {
          token,
          communityId: community.id as Id<"communities">,
          groupId: selectedGroupId as Id<"groups"> | undefined,
          pageSize: PAGE_SIZE,
          page: currentPage,
        }
      : "skip"
  );

  // Transform search results to local format
  const searchResults = useMemo(() => {
    if (!searchData?.members) return null;
    return searchData.members.map((m: any) => ({
      user_id: m.id,
      first_name: m.firstName,
      last_name: m.lastName,
      email: m.email,
      phone: m.phone,
      profile_photo: m.profilePhoto,
      is_admin: m.isAdmin,
      is_primary_admin: false,
      notifications_disabled: !!m.notificationsDisabled,
    }));
  }, [searchData?.members]);

  const isSearching = debouncedSearch && searchData === undefined;
  const isLoading = (membersData === undefined && allMembers.length === 0 && !debouncedSearch) || isSearching;
  const isFetching = membersData === undefined && !debouncedSearch;

  // Helper function to transform API members to local format
  const transformMembers = React.useCallback((members: any[]) => {
    return members.map((m: any) => ({
      user_id: m.id,
      first_name: m.firstName,
      last_name: m.lastName,
      email: m.email,
      phone: m.phone,
      profile_photo: m.profilePhoto,
      is_admin: m.isAdmin,
      is_primary_admin: m.isPrimaryAdmin,
      notifications_disabled: !!m.notificationsDisabled,
    }));
  }, []);

  // Transform and accumulate members when data changes
  React.useEffect(() => {
    if (membersData?.members) {
      const transformedMembers = transformMembers(membersData.members);

      if (currentPage === 1) {
        setAllMembers(transformedMembers);
      } else {
        setAllMembers((prev) => {
          // Avoid duplicates
          const existingIds = new Set(prev.map((m) => m.user_id));
          const newMembers = transformedMembers.filter(
            (m: CommunityMember) => !existingIds.has(m.user_id)
          );
          return [...prev, ...newMembers];
        });
      }
    }
  }, [membersData, currentPage, transformMembers]);

  // Ensure members are populated when we have data but empty state
  // This handles the case when component remounts with cached query data
  React.useEffect(() => {
    if (membersData?.members && membersData.members.length > 0 && allMembers.length === 0 && currentPage === 1 && !isFetching) {
      setAllMembers(transformMembers(membersData.members));
    }
  }, [membersData, allMembers.length, currentPage, isFetching, transformMembers]);

  // Reset pagination when filters change (but not on initial mount)
  React.useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    setCurrentPage(1);
    setAllMembers([]);
  }, [debouncedSearch, selectedGroupId]);

  // Use search results when searching, otherwise use browsing results
  const members = debouncedSearch ? (searchResults ?? []) : allMembers;
  // Check if there's more data based on returned results (hasMoreData from backend)
  const hasNextPage = debouncedSearch ? false : (membersData?.hasMoreData ?? false);
  const isFetchingNextPage = isFetching && currentPage > 1 && !debouncedSearch;

  const fetchNextPage = useCallback(() => {
    if (hasNextPage && !isFetching) {
      setCurrentPage((prev) => prev + 1);
    }
  }, [hasNextPage, isFetching]);

  // Fetch user's groups for filter dropdown using Convex
  const userGroupsRaw = useQuery(
    api.functions.groups.queries.listForUser,
    community?.id && token
      ? {
          token,
          communityId: community.id as Id<"communities">,
        }
      : "skip"
  );

  // Transform groups to expected format
  const userGroups = useMemo(() => {
    if (!userGroupsRaw) return [];
    return userGroupsRaw.map((g: any) => ({
      id: g._id,
      name: g.name,
    }));
  }, [userGroupsRaw]);

  const handleMemberPress = useCallback((userId: string) => {
    router.push(`/admin/person/${userId}`);
  }, [router]);

  const handleClearSearch = useCallback(() => {
    setSearchQuery("");
    setDebouncedSearch("");
    setCurrentPage(1);
    setAllMembers([]);
  }, []);

  const handleClearFilter = () => {
    setSelectedGroupId(undefined);
    setShowGroupFilter(false);
  };

  const selectedGroup = useMemo(() => {
    if (!selectedGroupId || !userGroups) return null;
    return userGroups.find((g) => g.id === selectedGroupId);
  }, [selectedGroupId, userGroups]);

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetching) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetching, fetchNextPage]);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    setCurrentPage(1);
    setAllMembers([]);
    // Convex auto-refreshes, so we just need to reset state
    setTimeout(() => setIsRefreshing(false), 500);
  }, []);

  const renderMember = useCallback(
    ({ item }: { item: CommunityMember }) => (
      <MemberCard
        member={item}
        onPress={() => handleMemberPress(item.user_id)}
      />
    ),
    [handleMemberPress]
  );

  const renderFooter = useCallback(() => {
    if (!isFetchingNextPage) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color={primaryColor} />
        <Text style={[styles.loadingMoreText, { color: colors.textSecondary }]}>Loading more...</Text>
      </View>
    );
  }, [isFetchingNextPage, primaryColor, colors.textSecondary]);

  const isEmpty = members.length === 0 && !isLoading;

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundSecondary }]}>
      {/* Search and Filter Bar */}
      <View style={[styles.searchContainer, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <View style={[styles.searchInputContainer, { backgroundColor: colors.surfaceSecondary }]}>
          <Ionicons name="search" size={20} color={colors.icon} style={styles.searchIcon} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Search by name, email, or phone"
            placeholderTextColor={colors.inputPlaceholder}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={handleClearSearch} style={styles.clearButton}>
              <Ionicons name="close-circle" size={20} color={colors.textTertiary} />
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={[styles.filterButton, { backgroundColor: colors.surfaceSecondary }, selectedGroupId && { backgroundColor: `${primaryColor}20` }]}
          onPress={() => setShowGroupFilter(!showGroupFilter)}
        >
          <Ionicons
            name="filter"
            size={20}
            color={selectedGroupId ? primaryColor : colors.icon}
          />
        </TouchableOpacity>
      </View>

      {/* Group Filter Dropdown */}
      {showGroupFilter && (
        <View style={[styles.filterDropdown, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <Text style={[styles.filterTitle, { color: colors.text }]}>Filter by Group</Text>
          <ScrollView style={styles.filterList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {selectedGroupId && (
              <TouchableOpacity
                style={[styles.filterOption, { borderBottomColor: colors.surfaceSecondary }]}
                onPress={handleClearFilter}
              >
                <Text style={[styles.filterOptionTextClear, { color: colors.destructive }]}>All Members</Text>
                <Ionicons name="close-circle" size={20} color={colors.destructive} />
              </TouchableOpacity>
            )}
            {userGroups?.map((group) => (
              <TouchableOpacity
                key={group.id}
                style={[
                  styles.filterOption,
                  { borderBottomColor: colors.surfaceSecondary },
                  selectedGroupId === group.id && { backgroundColor: `${primaryColor}10` },
                ]}
                onPress={() => {
                  setSelectedGroupId(group.id);
                  setShowGroupFilter(false);
                }}
              >
                <Text
                  style={[
                    styles.filterOptionText,
                    { color: colors.text },
                    selectedGroupId === group.id && { fontWeight: '600', color: primaryColor },
                  ]}
                >
                  {group.name}
                </Text>
                {selectedGroupId === group.id && (
                  <Ionicons name="checkmark" size={20} color={primaryColor} />
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Active Filter Display */}
      {selectedGroup && (
        <View style={[styles.activeFilter, { backgroundColor: `${primaryColor}10`, borderBottomColor: colors.border }]}>
          <Text style={[styles.activeFilterText, { color: primaryColor }]}>
            Showing members of: {selectedGroup.name}
          </Text>
          <TouchableOpacity onPress={handleClearFilter}>
            <Ionicons name="close-circle" size={18} color={primaryColor} />
          </TouchableOpacity>
        </View>
      )}

      {/* Summary */}
      <View style={[styles.summary, { backgroundColor: colors.surfaceSecondary }]}>
        <Text style={[styles.summaryText, { color: colors.textSecondary }]}>
          {isLoading
            ? "Searching..."
            : isEmpty
              ? "No members found"
              : debouncedSearch
                ? `${members.length} result${members.length === 1 ? "" : "s"} found`
                : `Showing ${members.length.toLocaleString()} member${members.length === 1 ? "" : "s"}`}
        </Text>
      </View>

      {isLoading ? (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading members...</Text>
        </View>
      ) : isEmpty ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="people-outline" size={64} color={colors.iconSecondary} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No members found</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            {searchQuery || selectedGroupId
              ? "Try adjusting your search or filter"
              : "No community members to display"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={members}
          renderItem={renderMember}
          keyExtractor={(item) => String(item.user_id)}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          ListFooterComponent={renderFooter}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        />
      )}
    </View>
  );
}

// Member card component
interface MemberCardProps {
  member: CommunityMember;
  onPress: () => void;
}

function MemberCard({ member, onPress }: MemberCardProps) {
  const { primaryColor } = useCommunityTheme();
  const { colors, isDark } = useTheme();
  const fullName = `${member.first_name} ${member.last_name}`;
  const initials = `${member.first_name?.[0] || ""}${member.last_name?.[0] || ""}`;

  return (
    <TouchableOpacity style={[styles.memberCard, { backgroundColor: colors.surface }]} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.memberAvatar}>
        {member.profile_photo ? (
          <Image source={{ uri: member.profile_photo }} style={styles.avatarImage} />
        ) : (
          <View style={[styles.avatarPlaceholder, { backgroundColor: primaryColor }]}>
            <Text style={styles.avatarInitials}>{initials}</Text>
          </View>
        )}
        {member.notifications_disabled ? (
          <NotificationsDisabledBadge avatarSize={48} />
        ) : null}
      </View>
      <View style={styles.memberInfo}>
        <View style={styles.memberNameRow}>
          <Text style={[styles.memberName, { color: colors.text }]}>{fullName}</Text>
          {member.is_primary_admin && (
            <View style={[styles.primaryAdminBadge, { backgroundColor: primaryColor }]}>
              <Text style={styles.primaryAdminBadgeText}>Primary Admin</Text>
            </View>
          )}
          {member.is_admin && !member.is_primary_admin && (
            <View style={[styles.adminBadge, { backgroundColor: isDark ? 'rgba(255,152,0,0.2)' : '#FFF5E7' }]}>
              <Text style={[styles.adminBadgeText, { color: isDark ? '#FFB74D' : '#995C00' }]}>Admin</Text>
            </View>
          )}
        </View>
        <Text style={[styles.memberEmail, { color: colors.textSecondary }]}>{member.email}</Text>
        {member.phone && (
          <Text style={[styles.memberPhone, { color: colors.textSecondary }]}>{member.phone}</Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.iconSecondary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
  },
  errorText: {
    marginTop: 12,
    fontSize: 16,
  },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  searchContainer: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 8,
  },
  searchInputContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 15,
  },
  clearButton: {
    padding: 4,
  },
  filterButton: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 8,
  },
  filterDropdown: {
    borderBottomWidth: 1,
    maxHeight: 300,
  },
  filterTitle: {
    fontSize: 14,
    fontWeight: "600",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  filterList: {
    maxHeight: 250,
  },
  filterOption: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  filterOptionSelected: {},
  filterOptionText: {
    fontSize: 15,
  },
  filterOptionTextSelected: {
    fontWeight: "600",
  },
  filterOptionTextClear: {
    fontSize: 15,
    fontWeight: "500",
  },
  activeFilter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  activeFilterText: {
    fontSize: 13,
    fontWeight: "500",
  },
  summary: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  summaryText: {
    fontSize: 14,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: "center",
    marginTop: 8,
  },
  scrollContent: {
    padding: 16,
    gap: 12,
  },
  memberCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    padding: 16,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    marginBottom: 12,
  },
  memberAvatar: {
    // overflow:hidden moved off the wrapper so the notifications-disabled
    // badge can peek past the bottom-right corner — same pattern as the
    // shared `<Avatar>` primitive.
    width: 56,
    height: 56,
    position: "relative",
  },
  avatarImage: {
    width: "100%",
    height: "100%",
    borderRadius: 28,
  },
  avatarPlaceholder: {
    width: "100%",
    height: "100%",
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarInitials: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#fff",
  },
  memberInfo: {
    flex: 1,
  },
  memberNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  memberName: {
    fontSize: 16,
    fontWeight: "600",
  },
  primaryAdminBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  primaryAdminBadgeText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#fff",
    textTransform: "uppercase",
  },
  adminBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  adminBadgeText: {
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  memberEmail: {
    fontSize: 13,
    marginTop: 2,
  },
  memberPhone: {
    fontSize: 13,
    marginTop: 2,
  },
  footerLoader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    gap: 8,
  },
  loadingMoreText: {
    fontSize: 14,
  },
});
