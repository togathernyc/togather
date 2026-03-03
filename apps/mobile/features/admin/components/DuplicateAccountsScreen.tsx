import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  Platform,
  Modal,
  Pressable,
} from "react-native";
import { format, formatDistanceToNow } from "date-fns";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useAuthenticatedMutation } from "@services/api/convex";
import { api, Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";

// Local type definitions
interface CommunityMembership {
  community_id: Id<"communities">;
  community_name: string;
  role: number;
  status: number;
  created_at: number;
}

interface GroupMembership {
  group_id: Id<"groups">;
  group_name: string;
  role: number;
  joined_at: number | null;
}

interface DuplicateAccount {
  id: Id<"users">;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  created_at: number;
  last_login: number | null;
  communities: CommunityMembership[];
  groups: GroupMembership[];
  groups_count: number;
  is_recommended: boolean;
}

interface DuplicateGroup {
  phone: string;
  accounts: DuplicateAccount[];
  most_recent_login: number | null;
}

interface MergedGroupInfo {
  group_id: Id<"groups">;
  group_name: string;
  role: number;
  was_transferred: boolean;
}

interface MergedAccountDetails {
  id: Id<"users">;
  email: string;
  first_name: string;
  last_name: string;
  groups_transferred: number;
}

interface MergeDecision {
  phone: string;
  primary_account_id: Id<"users"> | null;
  primary_email: string;
  primary_name: string;
  secondary_account_ids: Id<"users">[];
  secondary_accounts: MergedAccountDetails[];
  groups: MergedGroupInfo[];
  merged_at: number | null;
  merged_by: string | null;
}

const ROLE_LABELS: Record<number, string> = {
  0: "Visitor",
  1: "Member",
  2: "Leader",
  3: "Admin",
  4: "Super Admin",
};

const GROUP_ROLE_LABELS: Record<number, string> = {
  1: "Member",
  2: "Leader",
};

type Tab = "pending" | "merged";

// Custom confirmation modal component
function ConfirmModal({
  visible,
  title,
  message,
  onConfirm,
  onCancel,
  confirmText = "Confirm",
  cancelText = "Cancel",
  isLoading = false,
}: {
  visible: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
  isLoading?: boolean;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <Pressable style={styles.modalOverlay} onPress={onCancel}>
        <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.modalTitle}>{title}</Text>
          <Text style={styles.modalMessage}>{message}</Text>
          <View style={styles.modalButtons}>
            <TouchableOpacity
              style={[styles.modalButton, styles.modalCancelButton]}
              onPress={onCancel}
              disabled={isLoading}
            >
              <Text style={styles.modalCancelText}>{cancelText}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalButton, styles.modalConfirmButton, isLoading && styles.modalButtonDisabled]}
              onPress={onConfirm}
              disabled={isLoading}
            >
              <Text style={styles.modalConfirmText}>
                {isLoading ? "Merging..." : confirmText}
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function DuplicateAccountsScreen() {
  const { user, isLoading: authLoading, community, token } = useAuth();
  const insets = useSafeAreaInsets();
  const [selectedPrimary, setSelectedPrimary] = useState<
    Record<string, Id<"users">>
  >({});
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<Tab>("pending");
  const [confirmModal, setConfirmModal] = useState<{
    visible: boolean;
    group: DuplicateGroup | null;
    primaryAccount: DuplicateAccount | null;
    secondaryCount: number;
  }>({ visible: false, group: null, primaryAccount: null, secondaryCount: 0 });
  const [isMerging, setIsMerging] = useState(false);

  const communityId = community?.id as Id<"communities"> | undefined;

  // Fetch duplicate accounts using Convex
  const rawDuplicatesData = useQuery(
    api.functions.admin.duplicates.listDuplicateAccounts,
    communityId && token && !authLoading && activeTab === "pending"
      ? { token, communityId }
      : "skip"
  );

  const isLoading = rawDuplicatesData === undefined && !authLoading && activeTab === "pending";
  const error = rawDuplicatesData === null;

  // Transform data to snake_case format for compatibility
  const duplicatesData = rawDuplicatesData ? {
    total_duplicate_phones: rawDuplicatesData.totalDuplicatePhones,
    total_affected_accounts: rawDuplicatesData.totalAffectedAccounts,
    accounts_to_merge: rawDuplicatesData.accountsToMerge,
    duplicate_groups: rawDuplicatesData.duplicateGroups.map((group: any) => ({
      phone: group.phone,
      most_recent_login: group.mostRecentLogin,
      accounts: group.accounts.map((acc: any) => ({
        id: acc.id,
        email: acc.email,
        first_name: acc.firstName,
        last_name: acc.lastName,
        phone: acc.phone,
        created_at: acc.createdAt,
        last_login: acc.lastLogin,
        communities: acc.communities.map((c: any) => ({
          community_id: c.communityId,
          community_name: c.communityName,
          role: c.role,
          status: c.status,
          created_at: c.createdAt,
        })),
        groups: acc.groups.map((g: any) => ({
          group_id: g.groupId,
          group_name: g.groupName,
          role: g.role,
          joined_at: g.joinedAt,
        })),
        groups_count: acc.groupsCount,
        is_recommended: acc.isRecommended,
      })),
    })),
  } : null;

  // Fetch merged accounts using Convex
  const rawMergedData = useQuery(
    api.functions.admin.duplicates.listMergedAccounts,
    communityId && token && !authLoading && activeTab === "merged"
      ? { token, communityId }
      : "skip"
  );

  const mergedLoading = rawMergedData === undefined && !authLoading && activeTab === "merged";
  const mergedError = rawMergedData === null;

  // Transform merged data
  const mergedData = rawMergedData ? {
    total_decisions: rawMergedData.totalDecisions,
    decisions: rawMergedData.decisions,
  } : null;

  // Merge mutation using Convex
  const mergeDuplicateAccounts = useAuthenticatedMutation(api.functions.admin.duplicates.mergeDuplicateAccounts);

  const handleMerge = (group: DuplicateGroup) => {
    const primaryId = selectedPrimary[group.phone];
    if (!primaryId) {
      Alert.alert("Error", "Please select a primary account first");
      return;
    }

    const secondaryIds = group.accounts
      .filter((acc: DuplicateAccount) => acc.id !== primaryId)
      .map((acc: DuplicateAccount) => acc.id);

    const primaryAcc = group.accounts.find((acc: DuplicateAccount) => acc.id === primaryId);

    // Show custom confirmation modal
    setConfirmModal({
      visible: true,
      group,
      primaryAccount: primaryAcc || null,
      secondaryCount: secondaryIds.length,
    });
  };

  const doMerge = async () => {
    if (!confirmModal.group || !communityId) return;

    const primaryId = selectedPrimary[confirmModal.group.phone];
    const secondaryIds = confirmModal.group.accounts
      .filter((acc: DuplicateAccount) => acc.id !== primaryId)
      .map((acc: DuplicateAccount) => acc.id);

    setIsMerging(true);
    try {
      const result = await mergeDuplicateAccounts({
        communityId,
        phone: confirmModal.group.phone,
        primaryAccountId: primaryId,
        secondaryAccountIds: secondaryIds,
      });
      setConfirmModal({ visible: false, group: null, primaryAccount: null, secondaryCount: 0 });
      Alert.alert("Success", result.message);
    } catch (error: any) {
      setConfirmModal({ visible: false, group: null, primaryAccount: null, secondaryCount: 0 });
      Alert.alert(
        "Error",
        error?.message || "Failed to merge accounts"
      );
    }
    setIsMerging(false);
  };

  const toggleGroup = (phone: string) => {
    setExpandedGroups((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(phone)) {
        newSet.delete(phone);
      } else {
        newSet.add(phone);
      }
      return newSet;
    });
  };

  const selectRecommendedForAll = () => {
    if (!duplicatesData?.duplicate_groups) return;

    const newSelections: Record<string, Id<"users">> = {};
    for (const group of duplicatesData.duplicate_groups) {
      const recommended = group.accounts.find((acc: DuplicateAccount) => acc.is_recommended);
      if (recommended) {
        newSelections[group.phone] = recommended.id;
      }
    }
    setSelectedPrimary(newSelections);
  };

  const duplicates = duplicatesData?.duplicate_groups || [];
  const mergedDecisions = mergedData?.decisions || [];

  const formatDateValue = (dateValue: number | string | null) => {
    if (!dateValue) return "Unknown";
    try {
      const date = typeof dateValue === "number" ? new Date(dateValue) : new Date(dateValue);
      return format(date, "MMM d, yyyy");
    } catch {
      return String(dateValue);
    }
  };

  const formatRelativeDate = (dateValue: number | string | null) => {
    if (!dateValue) return "Never";
    try {
      const date = typeof dateValue === "number" ? new Date(dateValue) : new Date(dateValue);
      return formatDistanceToNow(date, { addSuffix: true });
    } catch {
      return String(dateValue);
    }
  };

  const renderPendingContent = () => {
    if (authLoading || isLoading) {
      return (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Loading duplicate accounts...</Text>
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.centerContainer}>
          <Text style={styles.errorText}>Failed to load duplicate accounts</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => {}}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (duplicates.length === 0) {
      return (
        <View style={styles.centerContainer}>
          <Text style={styles.successText}>No duplicate accounts found!</Text>
          <Text style={styles.subtitleText}>
            All accounts have unique phone numbers.
          </Text>
        </View>
      );
    }

    return (
      <ScrollView style={styles.scrollContainer}>
        {/* Stats Header */}
        <View style={styles.statsHeader}>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>
              {duplicatesData?.total_duplicate_phones}
            </Text>
            <Text style={styles.statLabel}>Duplicate Phones</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>
              {duplicatesData?.total_affected_accounts}
            </Text>
            <Text style={styles.statLabel}>Total Accounts</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>
              {duplicatesData?.accounts_to_merge}
            </Text>
            <Text style={styles.statLabel}>To Merge</Text>
          </View>
        </View>

        {/* Quick Actions */}
        <View style={styles.actionsBar}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={selectRecommendedForAll}
          >
            <Text style={styles.actionButtonText}>
              Select All Recommended
            </Text>
          </TouchableOpacity>
        </View>

        {/* Duplicate Groups */}
        {duplicates.map((group: DuplicateGroup) => (
          <View key={group.phone} style={styles.groupCard}>
            <View style={styles.groupHeader}>
              <TouchableOpacity
                style={styles.groupHeaderTouchable}
                onPress={() => toggleGroup(group.phone)}
              >
                <View style={styles.groupHeaderLeft}>
                  <Text style={styles.phoneNumber}>{group.phone}</Text>
                  <View style={styles.groupSubInfo}>
                    <Text style={styles.accountCount}>
                      {group.accounts.length} accounts
                    </Text>
                    {group.most_recent_login && (
                      <Text style={styles.lastLoginText}>
                        {" "}Last login:{" "}
                        {formatRelativeDate(group.most_recent_login)}
                      </Text>
                    )}
                  </View>
                </View>
                <Text style={styles.expandIcon}>
                  {expandedGroups.has(group.phone) ? "v" : ">"}
                </Text>
              </TouchableOpacity>
              {selectedPrimary[group.phone] && (
                <TouchableOpacity
                  style={[
                    styles.mergeButton,
                    isMerging && styles.mergeButtonDisabled,
                  ]}
                  onPress={() => handleMerge(group)}
                  disabled={isMerging}
                >
                  <Text style={styles.mergeButtonText}>
                    {isMerging ? "Merging..." : "Merge"}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {expandedGroups.has(group.phone) && (
              <View style={styles.accountsList}>
                {group.accounts.map((account: DuplicateAccount) => (
                  <AccountRow
                    key={String(account.id)}
                    account={account}
                    isSelected={selectedPrimary[group.phone] === account.id}
                    onSelect={() =>
                      setSelectedPrimary((prev) => ({
                        ...prev,
                        [group.phone]: account.id,
                      }))
                    }
                    formatDate={formatDateValue}
                    formatRelativeDate={formatRelativeDate}
                  />
                ))}
              </View>
            )}
          </View>
        ))}

        <View style={styles.bottomPadding} />
      </ScrollView>
    );
  };

  const renderMergedContent = () => {
    if (authLoading || mergedLoading) {
      return (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Loading merged accounts...</Text>
        </View>
      );
    }

    if (mergedError) {
      return (
        <View style={styles.centerContainer}>
          <Text style={styles.errorText}>Failed to load merged accounts</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => {}}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (mergedDecisions.length === 0) {
      return (
        <View style={styles.centerContainer}>
          <Text style={styles.subtitleText}>No accounts have been merged yet.</Text>
          <Text style={styles.hintText}>
            Merged account decisions will appear here.
          </Text>
        </View>
      );
    }

    return (
      <ScrollView style={styles.scrollContainer}>
        <View style={styles.mergedStatsHeader}>
          <Text style={styles.mergedStatsText}>
            {mergedDecisions.length} merge decision{mergedDecisions.length !== 1 ? "s" : ""} recorded
          </Text>
        </View>

        {mergedDecisions.map((decision: MergeDecision, index: number) => (
          <MergedDecisionCard key={`${decision.phone}-${index}`} decision={decision} formatRelativeDate={formatRelativeDate} />
        ))}

        <View style={styles.bottomPadding} />
      </ScrollView>
    );
  };

  return (
    <View style={styles.container}>
      {/* Tabs */}
      <View style={[styles.tabBar, { paddingTop: insets.top }]}>
        <TouchableOpacity
          style={[styles.tab, activeTab === "pending" && styles.tabActive]}
          onPress={() => setActiveTab("pending")}
        >
          <Text style={[styles.tabText, activeTab === "pending" && styles.tabTextActive]}>
            Pending
          </Text>
          {duplicates.length > 0 && (
            <View style={styles.tabBadge}>
              <Text style={styles.tabBadgeText}>{duplicates.length}</Text>
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "merged" && styles.tabActive]}
          onPress={() => setActiveTab("merged")}
        >
          <Text style={[styles.tabText, activeTab === "merged" && styles.tabTextActive]}>
            Merged
          </Text>
          {mergedDecisions.length > 0 && (
            <View style={[styles.tabBadge, styles.tabBadgeMerged]}>
              <Text style={styles.tabBadgeText}>{mergedDecisions.length}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Tab Content */}
      {activeTab === "pending" ? renderPendingContent() : renderMergedContent()}

      {/* Confirmation Modal */}
      <ConfirmModal
        visible={confirmModal.visible}
        title="Confirm Merge"
        message={`Merge ${confirmModal.secondaryCount} account(s) into ${confirmModal.primaryAccount?.first_name} ${confirmModal.primaryAccount?.last_name} (${confirmModal.primaryAccount?.email})?\n\nThis action cannot be undone.`}
        confirmText="Merge"
        onConfirm={doMerge}
        onCancel={() => setConfirmModal({ visible: false, group: null, primaryAccount: null, secondaryCount: 0 })}
        isLoading={isMerging}
      />
    </View>
  );
}

// Component for displaying a merged decision with full details
function MergedDecisionCard({ decision, formatRelativeDate }: { decision: MergeDecision; formatRelativeDate: (d: number | string | null) => string }) {
  const [expanded, setExpanded] = useState(false);
  const transferredGroupsCount = decision.groups?.filter((g: any) => g.was_transferred).length || 0;
  const originalGroupsCount = (decision.groups?.length || 0) - transferredGroupsCount;

  return (
    <View style={styles.mergedCard}>
      {/* Header with phone and badge */}
      <TouchableOpacity
        style={styles.mergedCardHeader}
        onPress={() => setExpanded(!expanded)}
      >
        <View style={styles.mergedHeaderLeft}>
          <Text style={styles.mergedPhoneNumber}>{decision.phone}</Text>
          <Text style={styles.mergedSubtitle}>
            {decision.primary_name || "Unknown"} {decision.groups?.length || 0} groups
          </Text>
        </View>
        <View style={styles.mergedHeaderRight}>
          <View style={styles.mergedBadge}>
            <Text style={styles.mergedBadgeText}>Merged</Text>
          </View>
          <Text style={styles.expandIcon}>{expanded ? "v" : ">"}</Text>
        </View>
      </TouchableOpacity>

      {/* Primary Account Info */}
      <View style={styles.mergedPrimarySection}>
        <Text style={styles.mergedSectionTitle}>Primary Account</Text>
        <Text style={styles.mergedPrimaryEmail}>{decision.primary_email || "Unknown"}</Text>
        <Text style={styles.mergedPrimaryName}>{decision.primary_name || "Unknown"}</Text>
      </View>

      {/* Removed/Merged Accounts */}
      {decision.secondary_accounts && decision.secondary_accounts.length > 0 && (
        <View style={styles.mergedRemovedSection}>
          <Text style={styles.mergedSectionTitle}>Removed Accounts</Text>
          {decision.secondary_accounts.map((acc: any) => (
            <View key={String(acc.id)} style={styles.removedAccountRow}>
              <Text style={styles.removedAccountEmail}>{acc.email}</Text>
              <Text style={styles.removedAccountName}>
                {acc.first_name} {acc.last_name}
                {acc.groups_transferred > 0 && (
                  <Text style={styles.removedGroupsCount}>
                    {" "}({acc.groups_transferred} group{acc.groups_transferred !== 1 ? "s" : ""} transferred)
                  </Text>
                )}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Groups Section - always visible but collapsible for details */}
      {decision.groups && decision.groups.length > 0 && (
        <View style={styles.mergedGroupsSection}>
          <Text style={styles.mergedSectionTitle}>
            Groups ({decision.groups.length})
            {transferredGroupsCount > 0 && (
              <Text style={styles.transferredCount}> {transferredGroupsCount} transferred</Text>
            )}
          </Text>
          {expanded ? (
            <View style={styles.groupsList}>
              {decision.groups.map((group: any) => (
                <View
                  key={String(group.group_id)}
                  style={[
                    styles.mergedGroupChip,
                    group.was_transferred && styles.mergedGroupChipTransferred,
                  ]}
                >
                  <Text
                    style={[
                      styles.mergedGroupChipText,
                      group.was_transferred && styles.mergedGroupChipTextTransferred,
                    ]}
                  >
                    {group.group_name}
                    {group.role === 2 && " (Leader)"}
                  </Text>
                  {group.was_transferred && (
                    <Text style={styles.transferredLabel}>NEW</Text>
                  )}
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.groupsPreview}>
              {originalGroupsCount > 0 && `${originalGroupsCount} original`}
              {originalGroupsCount > 0 && transferredGroupsCount > 0 && " + "}
              {transferredGroupsCount > 0 && (
                <Text style={styles.transferredPreview}>{transferredGroupsCount} transferred</Text>
              )}
            </Text>
          )}
        </View>
      )}

      {/* Meta info */}
      <View style={styles.mergedMetaSection}>
        {decision.merged_at && (
          <Text style={styles.mergedMetaText}>
            Merged {formatRelativeDate(decision.merged_at)}
          </Text>
        )}
        {decision.merged_by && (
          <Text style={styles.mergedMetaText}>by {decision.merged_by}</Text>
        )}
      </View>
    </View>
  );
}

function AccountRow({
  account,
  isSelected,
  onSelect,
  formatDate,
  formatRelativeDate,
}: {
  account: DuplicateAccount;
  isSelected: boolean;
  onSelect: () => void;
  formatDate: (d: number | string | null) => string;
  formatRelativeDate: (d: number | string | null) => string;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.accountRow,
        isSelected && styles.accountRowSelected,
        account.is_recommended && styles.accountRowRecommended,
      ]}
      onPress={onSelect}
    >
      <View style={styles.radioContainer}>
        <View style={[styles.radio, isSelected && styles.radioSelected]}>
          {isSelected && <View style={styles.radioInner} />}
        </View>
      </View>

      <View style={styles.accountInfo}>
        <View style={styles.accountHeader}>
          <Text style={styles.accountName}>
            {account.first_name} {account.last_name}
          </Text>
          {account.is_recommended && (
            <View style={styles.recommendedBadge}>
              <Text style={styles.recommendedText}>Recommended</Text>
            </View>
          )}
        </View>

        <Text style={styles.accountEmail}>{account.email}</Text>

        <View style={styles.accountMeta}>
          <Text style={styles.metaText}>
            Created:{" "}
            {formatDate(account.created_at)}
          </Text>
          <Text style={styles.metaText}>
            Last login:{" "}
            {formatRelativeDate(account.last_login)}
          </Text>
        </View>

        <View style={styles.accountStats}>
          {account.communities.map((community: CommunityMembership) => (
            <View key={String(community.community_id)} style={styles.communityChip}>
              <Text style={styles.communityChipText}>
                {community.community_name} ({ROLE_LABELS[community.role] || "Unknown"})
              </Text>
            </View>
          ))}
        </View>

        {account.groups && account.groups.length > 0 && (
          <View style={styles.groupsSection}>
            <Text style={styles.groupsSectionLabel}>Groups:</Text>
            <View style={styles.groupsList}>
              {account.groups.map((group: GroupMembership) => (
                <View key={String(group.group_id)} style={styles.groupChip}>
                  <Text style={styles.groupChipText}>
                    {group.group_name}
                    {group.role === 2 && " (Leader)"}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: "#666",
  },
  errorText: {
    fontSize: 16,
    color: "#dc3545",
    marginBottom: 12,
  },
  successText: {
    fontSize: 20,
    fontWeight: "600",
    color: "#28a745",
    marginBottom: 8,
  },
  subtitleText: {
    fontSize: 14,
    color: "#666",
  },
  retryButton: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  statsHeader: {
    flexDirection: "row",
    backgroundColor: "#fff",
    padding: 16,
    marginBottom: 8,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  statBox: {
    flex: 1,
    alignItems: "center",
  },
  statNumber: {
    fontSize: 28,
    fontWeight: "700",
    color: "#333",
  },
  statLabel: {
    fontSize: 12,
    color: "#666",
    marginTop: 4,
  },
  actionsBar: {
    flexDirection: "row",
    padding: 12,
    gap: 12,
  },
  actionButton: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  actionButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  groupCard: {
    backgroundColor: "#fff",
    marginHorizontal: 12,
    marginBottom: 12,
    borderRadius: 12,
    overflow: "hidden",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  groupHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    gap: 12,
  },
  groupHeaderTouchable: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  groupHeaderLeft: {
    flex: 1,
  },
  phoneNumber: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
  },
  groupSubInfo: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    marginTop: 2,
    gap: 4,
  },
  accountCount: {
    fontSize: 13,
    color: "#666",
  },
  lastLoginText: {
    fontSize: 13,
    color: "#888",
  },
  mergeButton: {
    backgroundColor: "#28a745",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  mergeButtonDisabled: {
    backgroundColor: "#999",
  },
  mergeButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  expandIcon: {
    fontSize: 14,
    color: "#666",
  },
  accountsList: {
    padding: 8,
  },
  accountRow: {
    flexDirection: "row",
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    backgroundColor: "#f8f9fa",
    borderWidth: 2,
    borderColor: "transparent",
  },
  accountRowSelected: {
    borderColor: "#007AFF",
    backgroundColor: "#e7f3ff",
  },
  accountRowRecommended: {
    backgroundColor: "#f0fff4",
  },
  radioContainer: {
    marginRight: 12,
    paddingTop: 4,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#ccc",
    justifyContent: "center",
    alignItems: "center",
  },
  radioSelected: {
    borderColor: "#007AFF",
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#007AFF",
  },
  accountInfo: {
    flex: 1,
  },
  accountHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  accountName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  recommendedBadge: {
    backgroundColor: "#28a745",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  recommendedText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
  },
  accountEmail: {
    fontSize: 14,
    color: "#666",
    marginBottom: 8,
  },
  accountMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    marginBottom: 8,
  },
  metaText: {
    fontSize: 12,
    color: "#888",
  },
  accountStats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  communityChip: {
    backgroundColor: "#d4edda",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  communityChipText: {
    fontSize: 12,
    color: "#155724",
  },
  groupsSection: {
    marginTop: 8,
  },
  groupsSectionLabel: {
    fontSize: 12,
    color: "#666",
    fontWeight: "500",
    marginBottom: 4,
  },
  groupsList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  groupChip: {
    backgroundColor: "#e7f1ff",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  groupChipText: {
    fontSize: 12,
    color: "#0d6efd",
  },
  bottomPadding: {
    height: 40,
  },
  // Tab styles
  tabBar: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 14,
    gap: 8,
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: "#007AFF",
  },
  tabText: {
    fontSize: 15,
    fontWeight: "500",
    color: "#666",
  },
  tabTextActive: {
    color: "#007AFF",
  },
  tabBadge: {
    backgroundColor: "#dc3545",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    minWidth: 20,
    alignItems: "center",
  },
  tabBadgeMerged: {
    backgroundColor: "#28a745",
  },
  tabBadgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  scrollContainer: {
    flex: 1,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 24,
    width: "100%",
    maxWidth: 400,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#333",
    marginBottom: 12,
  },
  modalMessage: {
    fontSize: 15,
    color: "#555",
    lineHeight: 22,
    marginBottom: 24,
  },
  modalButtons: {
    flexDirection: "row",
    gap: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  modalCancelButton: {
    backgroundColor: "#f0f0f0",
  },
  modalConfirmButton: {
    backgroundColor: "#dc3545",
  },
  modalButtonDisabled: {
    backgroundColor: "#999",
  },
  modalCancelText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#666",
  },
  modalConfirmText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#fff",
  },
  // Merged accounts styles
  hintText: {
    fontSize: 13,
    color: "#888",
    marginTop: 4,
  },
  mergedStatsHeader: {
    backgroundColor: "#fff",
    padding: 16,
    marginBottom: 8,
  },
  mergedStatsText: {
    fontSize: 15,
    color: "#666",
  },
  mergedCard: {
    backgroundColor: "#fff",
    marginHorizontal: 12,
    marginBottom: 12,
    borderRadius: 12,
    padding: 16,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  mergedCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    marginBottom: 12,
  },
  mergedHeaderLeft: {
    flex: 1,
  },
  mergedHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  mergedPhoneNumber: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
  },
  mergedSubtitle: {
    fontSize: 13,
    color: "#666",
    marginTop: 2,
  },
  mergedBadge: {
    backgroundColor: "#28a745",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  mergedBadgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  mergedSectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: "#888",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  mergedPrimarySection: {
    marginBottom: 16,
  },
  mergedPrimaryEmail: {
    fontSize: 15,
    fontWeight: "500",
    color: "#333",
  },
  mergedPrimaryName: {
    fontSize: 14,
    color: "#666",
    marginTop: 2,
  },
  mergedRemovedSection: {
    marginBottom: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
  },
  removedAccountRow: {
    paddingVertical: 6,
    paddingLeft: 8,
    borderLeftWidth: 3,
    borderLeftColor: "#dc3545",
    marginBottom: 4,
  },
  removedAccountEmail: {
    fontSize: 14,
    color: "#dc3545",
    fontWeight: "500",
  },
  removedAccountName: {
    fontSize: 13,
    color: "#666",
    marginTop: 2,
  },
  removedGroupsCount: {
    color: "#28a745",
    fontWeight: "500",
  },
  mergedGroupsSection: {
    marginBottom: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
  },
  transferredCount: {
    color: "#ff9500",
    fontWeight: "500",
  },
  groupsPreview: {
    fontSize: 14,
    color: "#666",
  },
  transferredPreview: {
    color: "#ff9500",
    fontWeight: "500",
  },
  mergedGroupChip: {
    backgroundColor: "#e7f1ff",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  mergedGroupChipTransferred: {
    backgroundColor: "#fff3e0",
    borderWidth: 1,
    borderColor: "#ff9500",
  },
  mergedGroupChipText: {
    fontSize: 13,
    color: "#0d6efd",
  },
  mergedGroupChipTextTransferred: {
    color: "#e65100",
    fontWeight: "500",
  },
  transferredLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#fff",
    backgroundColor: "#ff9500",
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  mergedMetaSection: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
  },
  mergedMetaText: {
    fontSize: 12,
    color: "#888",
  },
});
