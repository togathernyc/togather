/**
 * MemberSearch - Unified member search component.
 *
 * A flexible, reusable component for searching community members.
 * Supports single/multi select, pagination, filtering, and custom rendering.
 *
 * @example Basic usage (single select)
 * ```tsx
 * <MemberSearch
 *   onSelect={(member) => console.log('Selected:', member)}
 *   placeholder="Search members..."
 * />
 * ```
 *
 * @example Multi-select with exclusions
 * ```tsx
 * <MemberSearch
 *   mode="multi"
 *   onMultiSelect={(members) => setSelectedMembers(members)}
 *   excludeUserIds={existingMemberIds}
 *   maxResults={5}
 * />
 * ```
 */
import React, { useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  FlatList,
  ScrollView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useMemberSearch, UseMemberSearchOptions, parseSearchTerms } from "@hooks/useMemberSearch";
import type { CommunityMember } from "@/types/community";

// Re-export types for convenience
export type { CommunityMember } from "@/types/community";

export interface MemberSearchProps extends Omit<UseMemberSearchOptions, "enabled"> {
  /** Called when a member is selected (single mode) */
  onSelect?: (member: CommunityMember) => void;
  /** Called when selection changes (multi mode) */
  onMultiSelect?: (members: CommunityMember[]) => void;
  /** Selection mode: single or multi */
  mode?: "single" | "multi";
  /** Placeholder text for search input */
  placeholder?: string;
  /** Maximum results to show (for compact mode, like adding members) */
  maxResults?: number;
  /** Whether to show pagination controls */
  showPagination?: boolean;
  /** Whether to show result count */
  showCount?: boolean;
  /** Whether to show empty state with icon */
  showEmptyState?: boolean;
  /** Clear search input after selection */
  clearOnSelect?: boolean;
  /** Whether the component is in a disabled/loading state */
  isDisabled?: boolean;
  /** Custom title above search */
  title?: string;
  /** Custom description below title */
  description?: string;
  /** Whether to show title section */
  showTitle?: boolean;
  /** Custom render function for member items */
  renderItem?: (
    member: CommunityMember,
    isSelected: boolean,
    onToggle: () => void
  ) => React.ReactNode;
  /** Custom empty state renderer */
  renderEmpty?: () => React.ReactNode;
  /** Container style */
  style?: any;
  /** Pre-selected members (for multi mode) */
  selectedMembers?: CommunityMember[];
  /** Show action button on items (add icon, checkbox, etc.) */
  showActionButton?: boolean;
  /** Custom action button icon */
  actionIcon?: keyof typeof Ionicons.glyphMap;
  /** Test ID for testing */
  testID?: string;
}

/**
 * Get initials from first and last name.
 */
function getInitials(firstName: string, lastName: string): string {
  return `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase();
}

/**
 * Default member item renderer.
 */
function DefaultMemberItem({
  member,
  isSelected,
  onToggle,
  primaryColor,
  showActionButton = true,
  actionIcon = "add-circle",
  isDisabled = false,
}: {
  member: CommunityMember;
  isSelected: boolean;
  onToggle: () => void;
  primaryColor: string;
  showActionButton?: boolean;
  actionIcon?: keyof typeof Ionicons.glyphMap;
  isDisabled?: boolean;
}) {
  const fullName = `${member.first_name} ${member.last_name}`;
  const initials = getInitials(member.first_name, member.last_name);

  return (
    <TouchableOpacity
      style={[
        styles.memberItem,
        isSelected && { backgroundColor: `${primaryColor}10` },
      ]}
      onPress={onToggle}
      activeOpacity={0.7}
      disabled={isDisabled}
    >
      <View style={styles.avatar}>
        {member.profile_photo ? (
          <Image
            source={{ uri: member.profile_photo }}
            style={styles.avatarImage}
          />
        ) : (
          <View style={[styles.avatarPlaceholder, { backgroundColor: primaryColor }]}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
        )}
      </View>
      <View style={styles.memberInfo}>
        <Text style={styles.memberName} numberOfLines={1}>
          {fullName}
        </Text>
        <Text style={styles.memberEmail} numberOfLines={1}>
          {member.email}
        </Text>
        {member.phone && (
          <Text style={styles.memberPhone} numberOfLines={1}>
            {member.phone}
          </Text>
        )}
      </View>
      {showActionButton && (
        isDisabled ? (
          <ActivityIndicator size="small" color={primaryColor} />
        ) : isSelected ? (
          <Ionicons name="checkmark-circle" size={24} color={primaryColor} />
        ) : (
          <Ionicons name={actionIcon} size={24} color={primaryColor} />
        )
      )}
    </TouchableOpacity>
  );
}

/**
 * Default empty state renderer.
 */
function DefaultEmptyState({
  searchQuery,
  showIcon = true,
}: {
  searchQuery: string;
  showIcon?: boolean;
}) {
  return (
    <View style={styles.emptyContainer}>
      {showIcon && (
        <Ionicons name="people-outline" size={48} color="#ccc" />
      )}
      <Text style={styles.emptyTitle}>No members found</Text>
      <Text style={styles.emptySubtitle}>
        {searchQuery
          ? `No results for "${searchQuery}"`
          : "Try searching by name, email, or phone"}
      </Text>
    </View>
  );
}

export function MemberSearch({
  onSelect,
  onMultiSelect,
  mode = "single",
  placeholder = "Search by name, email, or phone...",
  maxResults,
  showPagination = false,
  showCount = false,
  showEmptyState = true,
  clearOnSelect = true,
  isDisabled = false,
  title,
  description,
  showTitle = false,
  renderItem,
  renderEmpty,
  style,
  selectedMembers: externalSelectedMembers,
  showActionButton = true,
  actionIcon = "add-circle",
  testID,
  ...searchOptions
}: MemberSearchProps) {
  const { primaryColor } = useCommunityTheme();
  const [internalSelectedMembers, setInternalSelectedMembers] = React.useState<
    CommunityMember[]
  >([]);

  const selectedMembers = externalSelectedMembers ?? internalSelectedMembers;

  const {
    searchQuery,
    setSearchQuery,
    debouncedQuery,
    members,
    totalCount,
    hasNextPage,
    fetchNextPage,
    isLoading,
    isSearching,
    isFetchingNextPage,
    clearSearch,
  } = useMemberSearch({
    ...searchOptions,
    enabled: true,
  });

  // Apply maxResults limit if specified
  const displayedMembers = useMemo(() => {
    if (maxResults && maxResults > 0) {
      return members.slice(0, maxResults);
    }
    return members;
  }, [members, maxResults]);

  // Selection handling
  const selectedIds = useMemo(
    () => new Set(selectedMembers.map((m) => m.user_id)),
    [selectedMembers]
  );

  const handleToggleMember = useCallback(
    (member: CommunityMember) => {
      if (mode === "single") {
        onSelect?.(member);
        if (clearOnSelect) {
          clearSearch();
        }
      } else {
        const isSelected = selectedIds.has(member.user_id);
        let newSelection: CommunityMember[];

        if (isSelected) {
          newSelection = selectedMembers.filter(
            (m) => m.user_id !== member.user_id
          );
        } else {
          newSelection = [...selectedMembers, member];
        }

        if (!externalSelectedMembers) {
          setInternalSelectedMembers(newSelection);
        }
        onMultiSelect?.(newSelection);

        // Clear search after selection if requested (for adding members flow)
        if (clearOnSelect) {
          clearSearch();
        }
      }
    },
    [
      mode,
      onSelect,
      onMultiSelect,
      selectedMembers,
      selectedIds,
      clearOnSelect,
      clearSearch,
      externalSelectedMembers,
    ]
  );

  const handleClearSearch = useCallback(() => {
    clearSearch();
  }, [clearSearch]);

  // Determine if we should show results
  const minSearchLength = searchOptions.minSearchLength ?? 2;
  const hasValidQuery = parseSearchTerms(debouncedQuery).some(
    (term) => term.length >= minSearchLength
  );
  const shouldShowResults = hasValidQuery || displayedMembers.length > 0;

  // Render member item
  const renderMemberItem = useCallback(
    ({ item }: { item: CommunityMember }) => {
      const isSelected = selectedIds.has(item.user_id);

      if (renderItem) {
        return (
          <>
            {renderItem(item, isSelected, () => handleToggleMember(item))}
          </>
        );
      }

      return (
        <DefaultMemberItem
          member={item}
          isSelected={isSelected}
          onToggle={() => handleToggleMember(item)}
          primaryColor={primaryColor}
          showActionButton={showActionButton}
          actionIcon={actionIcon}
          isDisabled={isDisabled}
        />
      );
    },
    [
      selectedIds,
      renderItem,
      handleToggleMember,
      primaryColor,
      showActionButton,
      actionIcon,
      isDisabled,
    ]
  );

  // Render footer (loading indicator for pagination)
  const renderFooter = useCallback(() => {
    if (!isFetchingNextPage) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color={primaryColor} />
        <Text style={styles.loadingMoreText}>Loading more...</Text>
      </View>
    );
  }, [isFetchingNextPage, primaryColor]);

  return (
    <View style={[styles.container, style]} testID={testID}>
      {/* Title Section */}
      {showTitle && (title || description) && (
        <View style={styles.titleSection}>
          {title && <Text style={styles.title}>{title}</Text>}
          {description && <Text style={styles.description}>{description}</Text>}
        </View>
      )}

      {/* Search Input */}
      <View style={styles.searchContainer}>
        <Ionicons
          name="search"
          size={20}
          color="#666"
          style={styles.searchIcon}
        />
        <TextInput
          style={styles.searchInput}
          placeholder={placeholder}
          placeholderTextColor="#999"
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isDisabled}
          blurOnSubmit={false}
          testID={testID ? `${testID}-input` : undefined}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity
            onPress={handleClearSearch}
            style={styles.clearButton}
            disabled={isDisabled}
          >
            <Ionicons name="close-circle" size={20} color="#999" />
          </TouchableOpacity>
        )}
      </View>

      {/* Loading State */}
      {(isLoading || isSearching) && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={primaryColor} />
          <Text style={styles.loadingText}>Searching...</Text>
        </View>
      )}

      {/* Result Count */}
      {showCount && shouldShowResults && !isLoading && !isSearching && (
        <View style={styles.countContainer}>
          <Text style={styles.countText}>
            {totalCount === 0
              ? "No members found"
              : `${totalCount.toLocaleString()} member${totalCount === 1 ? "" : "s"}`}
            {displayedMembers.length < totalCount &&
              ` (showing ${displayedMembers.length})`}
          </Text>
        </View>
      )}

      {/* Results */}
      {shouldShowResults && !isLoading && !isSearching && (
        <>
          {displayedMembers.length === 0 ? (
            showEmptyState &&
            (renderEmpty ? (
              renderEmpty()
            ) : (
              <DefaultEmptyState
                searchQuery={debouncedQuery}
                showIcon={showEmptyState}
              />
            ))
          ) : showPagination ? (
            <FlatList
              data={displayedMembers}
              renderItem={renderMemberItem}
              keyExtractor={(item) => String(item.user_id)}
              onEndReached={hasNextPage ? fetchNextPage : undefined}
              onEndReachedThreshold={0.3}
              ListFooterComponent={renderFooter}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              style={styles.resultsList}
            />
          ) : (
            <ScrollView
              style={styles.resultsScroll}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
            >
              {displayedMembers.map((member) => (
                <View key={member.user_id}>
                  {renderMemberItem({ item: member })}
                </View>
              ))}
            </ScrollView>
          )}
        </>
      )}

      {/* No Results Message (for compact mode without full empty state) */}
      {hasValidQuery &&
        !isLoading &&
        !isSearching &&
        displayedMembers.length === 0 &&
        !showEmptyState && (
          <Text style={styles.noResultsText}>
            No members found matching "{debouncedQuery}"
          </Text>
        )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#fff",
    borderRadius: 12,
  },
  titleSection: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginBottom: 4,
  },
  description: {
    fontSize: 14,
    color: "#666",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F5F5F5",
    borderRadius: 10,
    paddingHorizontal: 12,
    marginHorizontal: 16,
    marginVertical: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
    color: "#333",
  },
  clearButton: {
    padding: 4,
  },
  loadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
  },
  loadingText: {
    marginLeft: 8,
    fontSize: 14,
    color: "#666",
  },
  countContainer: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  countText: {
    fontSize: 14,
    color: "#666",
  },
  resultsList: {
    flex: 1,
  },
  resultsScroll: {
    maxHeight: 300,
  },
  memberItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E5E5E5",
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginRight: 12,
    overflow: "hidden",
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
  avatarText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  memberInfo: {
    flex: 1,
    marginRight: 8,
  },
  memberName: {
    fontSize: 16,
    fontWeight: "500",
    color: "#333",
    marginBottom: 2,
  },
  memberEmail: {
    fontSize: 14,
    color: "#666",
  },
  memberPhone: {
    fontSize: 13,
    color: "#888",
    marginTop: 2,
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: 32,
    paddingHorizontal: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginTop: 4,
  },
  noResultsText: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    paddingVertical: 16,
    paddingHorizontal: 16,
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
    color: "#666",
  },
});

export default MemberSearch;
