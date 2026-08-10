import React, { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { CustomModal } from "@components/ui/Modal";
import { MemberSearch, CommunityMember } from "@components/ui";
import { useTheme } from "@hooks/useTheme";
import {
  useAuthenticatedMutation,
  api,
  type Id,
} from "@services/api/convex";
import { formatError } from "@/utils/error-handling";

interface AddGroupMembersModalProps {
  visible: boolean;
  onClose: () => void;
  groupId: string;
  onAdded?: (member: CommunityMember) => void;
}

export function AddGroupMembersModal({
  visible,
  onClose,
  groupId,
  onAdded,
}: AddGroupMembersModalProps) {
  const { colors } = useTheme();
  const addMember = useAuthenticatedMutation(api.functions.groupMembers.add);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAddedName, setLastAddedName] = useState<string | null>(null);

  const handleSelect = async (member: CommunityMember) => {
    if (!member.user_id || !groupId) return;
    setSubmitting(true);
    setError(null);
    try {
      await addMember({
        groupId: groupId as Id<"groups">,
        userId: String(member.user_id) as Id<"users">,
        role: "member",
      });
      setLastAddedName(`${member.first_name} ${member.last_name}`.trim());
      onAdded?.(member);
    } catch (e) {
      setError(formatError(e, "Failed to add member."));
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (submitting) return;
    setError(null);
    setLastAddedName(null);
    onClose();
  };

  return (
    <CustomModal visible={visible} onClose={handleClose} title="Add people">
      <View style={styles.container}>
        {lastAddedName ? (
          <Text style={[styles.success, { color: colors.success }]}>
            Added {lastAddedName}. Search to add more.
          </Text>
        ) : null}
        {error ? (
          <Text style={[styles.error, { color: colors.destructive }]}>
            {error}
          </Text>
        ) : null}
        <MemberSearch
          onSelect={handleSelect}
          excludeGroupMembersOfGroupId={groupId}
          isDisabled={submitting}
          placeholder="Search by name, email, or phone..."
          maxResults={5}
          showEmptyState={false}
          clearOnSelect
        />
      </View>
    </CustomModal>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 320,
  },
  success: {
    fontSize: 14,
    marginBottom: 8,
  },
  error: {
    fontSize: 14,
    marginBottom: 8,
  },
});
