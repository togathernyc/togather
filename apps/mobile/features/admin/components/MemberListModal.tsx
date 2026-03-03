/**
 * MemberListModal - Modal to display a list of members with search functionality
 *
 * Used by StatsContent to show active members or new members when clicking
 * on the stat cards. Supports navigation to member details page.
 */

import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { ExportBottomSheet } from "./ExportBottomSheet";
import { generateMembersCsv, generateFilename } from "../utils/csvExport";

type MemberListType = "active" | "new";

interface MemberListModalProps {
  visible: boolean;
  onClose: () => void;
  type: MemberListType;
}

interface MemberItem {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  profilePhoto: string | null;
  lastLogin?: string | null;
  joinedAt?: string | null;
}

const PAGE_SIZE = 30;

export function MemberListModal({ visible, onClose, type }: MemberListModalProps) {
  const router = useRouter();
  const { community, token, user } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [allMembers, setAllMembers] = useState<MemberItem[]>([]);
  const [showExportSheet, setShowExportSheet] = useState(false);
  const isInitialMount = useRef(true);
  const prevDataRef = useRef<typeof activeMembersData | typeof newMembersData | null>(null);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reset state when modal opens or type changes
  useEffect(() => {
    if (visible) {
      setSearchQuery("");
      setDebouncedSearch("");
      setCurrentPage(1);
      setAllMembers([]);
      isInitialMount.current = true;
    }
  }, [visible, type]);

  // Convex query for active members
  const activeMembersData = useQuery(
    api.functions.admin.stats.getActiveMembersList,
    visible && type === "active" && community?.id && token
      ? {
          token,
          communityId: community.id as Id<"communities">,
          page: currentPage,
          pageSize: PAGE_SIZE,
          search: debouncedSearch || undefined,
        }
      : "skip"
  );

  // Convex query for new members
  const newMembersData = useQuery(
    api.functions.admin.stats.getNewMembersList,
    visible && type === "new" && community?.id && token
      ? {
          token,
          communityId: community.id as Id<"communities">,
          page: currentPage,
          pageSize: PAGE_SIZE,
          search: debouncedSearch || undefined,
        }
      : "skip"
  );

  const data = type === "active" ? activeMembersData : newMembersData;
  const isLoading = data === undefined;
  // Track if we're fetching next page by comparing with previous data
  const isFetching = data === undefined;

  // Accumulate members when data changes
  useEffect(() => {
    if (data?.members) {
      // Only update if data actually changed
      if (prevDataRef.current !== data) {
        prevDataRef.current = data;
        if (currentPage === 1) {
          setAllMembers(data.members);
        } else {
          setAllMembers((prev) => {
            const existingIds = new Set(prev.map((m) => m.id));
            const newMembers = data.members.filter((m) => !existingIds.has(m.id));
            return [...prev, ...newMembers];
          });
        }
      }
    }
  }, [data, currentPage]);

  // Reset pagination when search changes
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    setCurrentPage(1);
    setAllMembers([]);
  }, [debouncedSearch]);

  const hasNextPage = data ? data.page < data.totalPages : false;
  const isFetchingNextPage = isFetching && currentPage > 1;

  const fetchNextPage = useCallback(() => {
    if (hasNextPage && !isFetching) {
      setCurrentPage((prev) => prev + 1);
    }
  }, [hasNextPage, isFetching]);

  const handleMemberPress = useCallback((userId: string) => {
    onClose();
    router.push(`/admin/person/${userId}`);
  }, [router, onClose]);

  const handleClearSearch = () => {
    setSearchQuery("");
  };

  const renderMember = useCallback(
    ({ item }: { item: MemberItem }) => {
      const fullName = `${item.firstName || ""} ${item.lastName || ""}`.trim() || "Unknown";
      const initials = `${item.firstName?.[0] || ""}${item.lastName?.[0] || ""}`.toUpperCase() || "?";
      const subtitle = type === "active" && item.lastLogin
        ? `Last active: ${new Date(item.lastLogin).toLocaleDateString()}`
        : type === "new" && item.joinedAt
        ? `Joined: ${new Date(item.joinedAt).toLocaleDateString()}`
        : item.email;

      return (
        <TouchableOpacity
          style={styles.memberItem}
          onPress={() => handleMemberPress(item.id)}
          activeOpacity={0.7}
        >
          <View style={styles.memberAvatar}>
            {item.profilePhoto ? (
              <Image source={{ uri: item.profilePhoto }} style={styles.avatarImage} />
            ) : (
              <View style={[styles.avatarPlaceholder, { backgroundColor: primaryColor }]}>
                <Text style={styles.avatarInitials}>{initials}</Text>
              </View>
            )}
          </View>
          <View style={styles.memberInfo}>
            <Text style={styles.memberName}>{fullName}</Text>
            <Text style={styles.memberSubtitle}>{subtitle}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#ccc" />
        </TouchableOpacity>
      );
    },
    [type, primaryColor, handleMemberPress]
  );

  const renderFooter = useCallback(() => {
    if (!isFetchingNextPage) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color={primaryColor} />
        <Text style={styles.loadingMoreText}>Loading more...</Text>
      </View>
    );
  }, [isFetchingNextPage, primaryColor]);

  const title = type === "active" ? "Active Members" : "New Members";
  const newMembersDataTyped = data && "monthName" in data ? data as { monthName?: string } : null;
  const subtitle = type === "active"
    ? "Members who logged in within the past month"
    : (newMembersDataTyped?.monthName
      ? `Members who joined in ${newMembersDataTyped.monthName}`
      : "Members who joined this month");

  // CSV export data
  const csvContent = useMemo(() => {
    if (allMembers.length === 0) return "";
    return generateMembersCsv(allMembers, type);
  }, [allMembers, type]);

  const csvFilename = useMemo(() => {
    return generateFilename(
      type === "active" ? "active_members" : "new_members",
      community?.name || "community"
    );
  }, [type, community?.name]);

  const handleExport = useCallback(() => {
    if (allMembers.length > 0) {
      setShowExportSheet(true);
    }
  }, [allMembers.length]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerContent}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>
          <View style={styles.headerButtons}>
            {allMembers.length > 0 && (
              <TouchableOpacity
                style={styles.exportButton}
                onPress={handleExport}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="download-outline" size={22} color={primaryColor} />
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <Ionicons name="close" size={24} color="#333" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <View style={styles.searchInputContainer}>
            <Ionicons name="search" size={20} color="#666" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by name or email..."
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={handleClearSearch} style={styles.clearButton}>
                <Ionicons name="close-circle" size={20} color="#999" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Summary */}
        <View style={styles.summary}>
          <Text style={styles.summaryText}>
            {isLoading
              ? "Loading..."
              : `${data?.total?.toLocaleString() ?? 0} member${(data?.total ?? 0) === 1 ? "" : "s"}`}
            {allMembers.length < (data?.total ?? 0) && ` (showing ${allMembers.length})`}
          </Text>
        </View>

        {/* Content */}
        {isLoading && currentPage === 1 ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={primaryColor} />
            <Text style={styles.loadingText}>Loading members...</Text>
          </View>
        ) : allMembers.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="people-outline" size={64} color="#ccc" />
            <Text style={styles.emptyTitle}>No members found</Text>
            <Text style={styles.emptySubtitle}>
              {searchQuery
                ? "Try adjusting your search"
                : type === "active"
                  ? "No members have logged in recently"
                  : "No new members this month"}
            </Text>
          </View>
        ) : (
          <FlatList
            data={allMembers}
            renderItem={renderMember}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.listContent}
            onEndReached={fetchNextPage}
            onEndReachedThreshold={0.3}
            ListFooterComponent={renderFooter}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          />
        )}
      </KeyboardAvoidingView>

      {/* Export Bottom Sheet */}
      <ExportBottomSheet
        visible={showExportSheet}
        onClose={() => setShowExportSheet(false)}
        csvContent={csvContent}
        filename={csvFilename}
        userEmail={user?.email || undefined}
        title={`Export ${title}`}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  headerContent: {
    flex: 1,
  },
  headerButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  exportButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
  },
  subtitle: {
    fontSize: 14,
    color: "#666",
    marginTop: 4,
  },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  searchInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
    borderRadius: 10,
    paddingHorizontal: 12,
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
  summary: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#f5f5f5",
  },
  summaryText: {
    fontSize: 14,
    color: "#666",
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
  },
  memberItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  memberAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
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
    fontSize: 18,
    fontWeight: "bold",
    color: "#fff",
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 2,
  },
  memberSubtitle: {
    fontSize: 13,
    color: "#666",
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
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#333",
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginTop: 8,
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
