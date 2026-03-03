import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { UserRoute } from "@components/guards/UserRoute";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthenticatedMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { Members } from "./Members";
import { useMembersPage } from "../hooks/useMembersPage";
import { useMemberActions } from "../hooks/useMemberActions";
import { useGroupMembers } from "../hooks";
import { useAuth } from "@providers/AuthProvider";
import { MemberSearch, CommunityMember } from "@components/ui";
import { formatError } from "@/utils/error-handling";
import { DragHandle } from "@components/ui/DragHandle";

export function MembersScreen() {
  // NOTE: group_id is expected to be a Convex Id<"groups"> passed from navigation.
  // The leader-tools routes should only receive Convex IDs, not legacy UUIDs.
  const { group_id } = useLocalSearchParams<{ group_id: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { group, isLoadingGroup, groupError, handleBack } = useMembersPage(
    group_id || ""
  );
  const { handleMemberAction } = useMemberActions(group_id || "");

  // Check if user is an admin or leader of this group
  const isAdmin = user?.is_admin === true;
  const isGroupLeader = group?.userRole === 'leader' || group?.userRole === 'admin';
  const canManageMembers = isAdmin || isGroupLeader;

  // State for showing/hiding the add member section
  const [showAddMember, setShowAddMember] = useState(false);

  // Get existing member IDs to exclude from search
  const { members } = useGroupMembers(group_id || "", {});
  const existingMemberIds = useMemo(
    () => members.map((m: any) => m.user?._id || m._id).filter(Boolean),
    [members]
  );

  // State for tracking add member loading
  const [isAddingMember, setIsAddingMember] = useState(false);

  // Mutation to add a member to the group (auto-injects token)
  const addMember = useAuthenticatedMutation(api.functions.groupMembers.add);

  const handleAddMember = async (member: CommunityMember) => {
    if (!group_id || !member.user_id) return;

    setIsAddingMember(true);
    try {
      // user_id contains the Convex Id<"users"> as a string (from useMemberSearch transform)
      await addMember({
        groupId: group_id as Id<"groups">,
        userId: String(member.user_id) as Id<"users">,
        role: "member",
      });
      Alert.alert(
        "Member Added",
        `Member has been added to the group.`
      );
    } catch (error: any) {
      console.error("Failed to add member:", error);
      Alert.alert("Error", formatError(error, "Failed to add member. Please try again."));
    } finally {
      setIsAddingMember(false);
    }
  };

  if (isLoadingGroup) {
    return (
      <UserRoute>
        <View style={styles.container}>
          <DragHandle />
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" />
            <Text style={styles.loadingText}>Loading...</Text>
          </View>
        </View>
      </UserRoute>
    );
  }

  if (groupError || !group) {
    return (
      <UserRoute>
        <View style={styles.container}>
          <DragHandle />
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>Group not found</Text>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => handleBack()}
            >
              <Text style={styles.errorText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      </UserRoute>
    );
  }

  return (
    <UserRoute>
      <DragHandle />
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={handleBack}
          testID="back-button"
        >
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>Members</Text>
          <Text style={styles.headerSubtitle}>
            {group.name || "Group"}
          </Text>
        </View>
        {/* Add Member Button for Admins and Leaders */}
        {canManageMembers && (
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => setShowAddMember(!showAddMember)}
            testID="add-member-button"
          >
            <Ionicons
              name={showAddMember ? "close" : "person-add"}
              size={24}
              color="#007AFF"
            />
          </TouchableOpacity>
        )}
      </View>

      {/* Add Member Search (Admins and Leaders) */}
      {canManageMembers && showAddMember && (
        <View style={styles.addMemberContainer}>
          <MemberSearch
            onSelect={handleAddMember}
            excludeUserIds={existingMemberIds}
            isDisabled={isAddingMember}
            placeholder="Search by name, email, or phone..."
            maxResults={5}
            showEmptyState={false}
          />
        </View>
      )}

      {/* Members Content */}
      <View style={styles.content}>
        <Members
          groupId={group_id || ""}
          onMemberAction={handleMemberAction}
          canManageMembers={canManageMembers}
        />
      </View>
    </UserRoute>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
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
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  errorText: {
    fontSize: 18,
    color: "#666",
    marginBottom: 20,
  },
  backButton: {
    marginRight: 12,
    padding: 4,
  },
  addButton: {
    padding: 8,
    marginLeft: 8,
  },
  addMemberContainer: {
    backgroundColor: "#f5f5f5",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  headerContent: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
  },
  headerSubtitle: {
    fontSize: 14,
    color: "#666",
    marginTop: 2,
  },
  content: {
    flex: 1,
  },
});
