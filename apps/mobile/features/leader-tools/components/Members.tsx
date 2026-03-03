import React, { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Avatar } from "@components/ui/Avatar";
import { SearchBar } from "@components/ui/SearchBar";
import { useAuth } from "@providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { format } from "date-fns";
import { MembershipRole } from "@/constants/membership";
import { useGroupMembers } from "../hooks";

interface MembersProps {
  groupId: string;
  onMemberAction?: (member: any, action: string) => void;
  /** Whether the current user can manage members (add/remove) */
  canManageMembers?: boolean;
}

interface MemberFilters {
  role?: "leader" | "member" | "all";
  noAttendanceDays?: number;
  rsvpStatus?: "going" | "not_going" | "not_answered";
  rsvpDate?: string;
}

export function Members({ groupId, onMemberAction, canManageMembers = false }: MembersProps) {
  const { user } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<string>(
    "-membership__role,last_name,first_name,id"
  );
  const [filters, setFilters] = useState<MemberFilters>({ role: "all" });
  const [selectedMember, setSelectedMember] = useState<any>(null);
  const [showActionsModal, setShowActionsModal] = useState(false);

  // Fetch members with pagination using infinite query
  // Role filtering is now handled server-side
  const {
    members,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
    isRefetching,
    error,
    data: membersData,
    totalCount,
  } = useGroupMembers(groupId, {
    search: searchQuery,
    sortBy,
    noAttendanceDays: filters.noAttendanceDays,
    rsvpStatus: filters.rsvpStatus,
    rsvpDate: filters.rsvpDate,
    role: filters.role === "all" ? undefined : filters.role,
  });

  // Debug: Log the role being passed to the hook
  if (__DEV__) {
    console.log('📊 Members component render:', {
      filterRole: filters.role,
      hookRole: filters.role === "all" ? undefined : filters.role,
      membersCount: members.length,
    });
  }

  // No need for client-side filtering - server handles role filtering
  const filteredMembers = members;

  const handleMemberPress = (member: any) => {
    // Only open modal if member exists
    if (!member) {
      console.warn("Attempted to open modal with null/undefined member");
      return;
    }

    // Debug: Log member structure to help diagnose issues
    if (__DEV__) {
      console.log("🔍 Opening member modal:", {
        member,
        hasRole: !!member.role,
        hasMembership: !!member.membership,
        membershipRole: member.membership?.role,
      });
    }

    setSelectedMember(member);
    setShowActionsModal(true);
  };

  const handleAction = (action: string) => {
    if (onMemberAction && selectedMember) {
      onMemberAction(selectedMember, action);
    }
    setShowActionsModal(false);
    setSelectedMember(null);
  };

  const handleLoadMore = () => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  };

  const renderMemberItem = ({ item }: { item: any }) => {
    if (!item) return null;

    const memberRole = item?.role || item?.membership?.role;
    const isLeader =
      memberRole === "leader" ||
      memberRole === MembershipRole.LEADER ||
      memberRole === 2;
    const isCurrentUser = user?.id === item?.id;

    return (
      <TouchableOpacity
        style={styles.memberItem}
        onPress={() => handleMemberPress(item)}
      >
        <View style={styles.memberInfo}>
          <Avatar
            name={`${item?.first_name || ""} ${item?.last_name || ""}`}
            imageUrl={item?.profile_photo}
            size={48}
          />
          <View style={styles.memberDetails}>
            <View style={styles.memberNameRow}>
              <Text style={styles.memberName}>
                {item?.first_name} {item?.last_name}
                {isCurrentUser && " (You)"}
              </Text>
              {isLeader && (
                <View style={[styles.leaderBadge, { backgroundColor: primaryColor }]}>
                  <Text style={styles.leaderBadgeText}>Leader</Text>
                </View>
              )}
            </View>
            {item?.joined_at && (
              <Text style={styles.memberMeta}>
                Joined {format(new Date(item.joined_at), "MMM yyyy")}
              </Text>
            )}
          </View>
        </View>
        <Ionicons name="chevron-forward" size={20} color="#999" />
      </TouchableOpacity>
    );
  };

  const handleFilterChange = useCallback(
    (newRole: "all" | "leader" | "member") => {
      if (__DEV__) {
        console.log('🔄 Members filter changing to:', newRole);
      }
      // Use functional update to avoid stale closures
      setFilters((prev) => {
        if (prev.role === newRole) {
          if (__DEV__) {
            console.log('⏭️  Filter unchanged, skipping');
          }
          return prev; // No change, avoid re-render
        }
        if (__DEV__) {
          console.log('✅ Filter updated:', { prev: prev.role, new: newRole });
        }
        return { ...prev, role: newRole };
      });
    },
    []
  );

  const renderFilterChips = () => {
    const activeChipStyle = { backgroundColor: primaryColor, borderColor: primaryColor };
    return (
      <View style={styles.filterSection}>
        <View style={styles.filterRow}>
          <View style={styles.filterChips}>
            <TouchableOpacity
              style={[
                styles.filterChip,
                filters.role === "all" && activeChipStyle,
              ]}
              onPress={() => handleFilterChange("all")}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.filterChipText,
                  filters.role === "all" && styles.filterChipTextActive,
                ]}
              >
                All
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.filterChip,
                filters.role === "leader" && activeChipStyle,
              ]}
              onPress={() => handleFilterChange("leader")}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.filterChipText,
                  filters.role === "leader" && styles.filterChipTextActive,
                ]}
              >
                Leaders
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.filterChip,
                filters.role === "member" && activeChipStyle,
              ]}
              onPress={() => handleFilterChange("member")}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.filterChipText,
                  filters.role === "member" && styles.filterChipTextActive,
                ]}
              >
                Members
              </Text>
            </TouchableOpacity>
          </View>
          {totalCount > 0 && (
            <Text style={styles.totalCountText}>
              {totalCount} total
            </Text>
          )}
        </View>
      </View>
    );
  };

  // Debug: Log members data to help diagnose issues
  if (__DEV__ && membersData) {
    console.log("🔍 Members data:", {
      totalMembers: members.length,
      filteredCount: filteredMembers.length,
      membersData: Array.isArray(membersData) ? membersData : membersData,
    });
  }

  if (isLoading && !membersData) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>Loading members...</Text>
      </View>
    );
  }

  // Debug: Log error details
  if (error && __DEV__) {
    const err = error as Error;
    const errorObj = error as Error & { response?: { status?: number; statusText?: string; data?: unknown } };
    console.error(
      "❌ Members fetch error:",
      JSON.stringify(
        {
          errorMessage: err.message || String(error),
          errorStack: err.stack,
          status: errorObj?.response?.status,
          statusText: errorObj?.response?.statusText,
          data: errorObj?.response?.data,
          groupId,
          isLoading,
          hasData: !!membersData,
        },
        null,
        2
      )
    );
  }

  // Show error state if there's an error and no data
  if (error && !membersData) {
    // Extract error message - cast to Error to satisfy TypeScript
    const err = error as Error;
    let errorMessage = "Please try again";
    if (err.message) {
      errorMessage = err.message;
    } else {
      // Handle axios errors
      const axiosError = error as Error & { response?: { data?: { detail?: string; message?: string; error?: string } | string } };
      if (axiosError?.response?.data) {
        const data = axiosError.response.data;
        if (typeof data === "string") {
          errorMessage = data;
        } else if (data.detail) {
          errorMessage = data.detail;
        } else if (data.message) {
          errorMessage = data.message;
        } else if (data.error) {
          errorMessage = data.error;
        }
      }
    }

    return (
      <View style={styles.errorContainer}>
        <Ionicons name="alert-circle-outline" size={48} color="#e74c3c" />
        <Text style={styles.errorText}>Failed to load members</Text>
        <Text style={styles.errorSubtext}>{errorMessage}</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => {
            console.log("🔄 Retrying members fetch...");
            refetch();
          }}
        >
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <SearchBar
          placeholder="Search members..."
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {/* Filter Chips */}
      {renderFilterChips()}

      {/* Members List */}
      <FlatList
        data={filteredMembers}
        renderItem={renderMemberItem}
        keyExtractor={(item, index) => item?.id?.toString() || index.toString()}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          isFetchingNextPage ? (
            <View style={styles.loadingMore}>
              <ActivityIndicator size="small" />
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>
              {searchQuery || filters.role !== "all"
                ? "No members found matching your criteria"
                : "No members in this group"}
            </Text>
          </View>
        }
      />

      {/* Member Actions Modal */}
      <MemberActionsModal
        visible={showActionsModal && !!selectedMember}
        member={selectedMember}
        onClose={() => {
          setShowActionsModal(false);
          setSelectedMember(null);
        }}
        onAction={handleAction}
        canManageMembers={canManageMembers}
      />
    </View>
  );
}

interface MemberActionsModalProps {
  visible: boolean;
  member: any;
  onClose: () => void;
  onAction: (action: string) => void;
  /** Whether the current user can manage members (add/remove) */
  canManageMembers?: boolean;
}

function MemberActionsModal({
  visible,
  member,
  onClose,
  onAction,
  canManageMembers = false,
}: MemberActionsModalProps) {
  const { user } = useAuth();

  // Early return if no member or not visible - do this FIRST before any property access
  if (!member || !visible) {
    return null;
  }

  // Use optional chaining throughout to be extra defensive
  // Even though we checked member is not null, member.role or member.membership could be null
  const memberRole = member?.role || member?.membership?.role;
  const isLeader =
    memberRole === "leader" ||
    memberRole === MembershipRole.LEADER ||
    memberRole === 2;
  const isCurrentUser = user?.id === member?.id;

  // Only community admins can promote/demote members
  const canPromoteDemote = user?.is_admin ?? false;

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {member?.first_name || ""} {member?.last_name || ""}
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.modalCloseButton}>
              <Ionicons name="close" size={24} color="#333" />
            </TouchableOpacity>
          </View>

          <View style={styles.modalActions}>
            {canPromoteDemote && (
              <>
                {isLeader ? (
                  <TouchableOpacity
                    style={styles.modalActionButton}
                    onPress={() => onAction("demote")}
                  >
                    <Ionicons name="arrow-down" size={20} color="#333" />
                    <Text style={styles.modalActionText}>Demote to Member</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={styles.modalActionButton}
                    onPress={() => onAction("promote")}
                  >
                    <Ionicons name="arrow-up" size={20} color="#333" />
                    <Text style={styles.modalActionText}>
                      Promote to Leader
                    </Text>
                  </TouchableOpacity>
                )}
              </>
            )}
            {canManageMembers && !isCurrentUser && (
              <TouchableOpacity
                style={[
                  styles.modalActionButton,
                  styles.modalActionButtonDanger,
                ]}
                onPress={() => onAction("remove")}
              >
                <Ionicons name="person-remove" size={20} color="#e74c3c" />
                <Text
                  style={[styles.modalActionText, styles.modalActionTextDanger]}
                >
                  Remove from Group
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  searchContainer: {
    padding: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  filterSection: {
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  filterChips: {
    flexDirection: "row",
    gap: 8,
  },
  totalCountText: {
    fontSize: 14,
    color: "#666",
    fontWeight: "500",
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#f0f0f0",
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  filterChipActive: {
    // backgroundColor and borderColor set dynamically via style prop
  },
  filterChipText: {
    fontSize: 14,
    color: "#666",
    fontWeight: "500",
  },
  filterChipTextActive: {
    color: "#fff",
  },
  listContent: {
    padding: 16,
  },
  memberItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  memberInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  memberDetails: {
    marginLeft: 12,
    flex: 1,
  },
  memberNameRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  memberName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginRight: 8,
  },
  leaderBadge: {
    // backgroundColor set dynamically via style prop
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  leaderBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#fff",
    textTransform: "uppercase",
  },
  memberMeta: {
    fontSize: 13,
    color: "#666",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: "#666",
  },
  loadingMore: {
    paddingVertical: 20,
    alignItems: "center",
  },
  emptyState: {
    padding: 40,
    alignItems: "center",
  },
  emptyStateText: {
    fontSize: 16,
    color: "#999",
    textAlign: "center",
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  errorText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#e74c3c",
    marginTop: 16,
    textAlign: "center",
  },
  errorSubtext: {
    fontSize: 14,
    color: "#666",
    marginTop: 8,
    textAlign: "center",
  },
  retryButton: {
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: "#007bff",
    borderRadius: 8,
  },
  retryButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "transparent",
  },
  modalBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  modalContent: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 20,
    paddingBottom: 40,
    maxHeight: "50%",
    zIndex: 1,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
  },
  modalCloseButton: {
    padding: 4,
  },
  modalActions: {
    paddingTop: 20,
  },
  modalActionButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  modalActionButtonDanger: {
    borderBottomWidth: 0,
  },
  modalActionText: {
    fontSize: 16,
    color: "#333",
    marginLeft: 12,
  },
  modalActionTextDanger: {
    color: "#e74c3c",
  },
});
