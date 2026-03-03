import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { Group } from "../types";
import { getGroupTypeLabel } from "../utils/getGroupTypeLabel";
import { useAuth } from "@providers/AuthProvider";

interface JoinGroupButtonProps {
  onPress: () => void;
  onWithdraw?: () => void;
  isPending?: boolean;
  group?: Group;
  requestStatus?: "pending" | "accepted" | "declined" | null;
  /** If provided, shows a message that joining adds user to this community */
  communityName?: string;
  /** Whether the user is already a member of the community */
  isInCommunity?: boolean;
}

export function JoinGroupButton({
  onPress,
  onWithdraw,
  isPending = false,
  group,
  requestStatus = null,
  communityName,
  isInCommunity = true,
}: JoinGroupButtonProps) {
  const { user } = useAuth();

  // Get the group type label - prefer group_type_name, then extract from object, then use ID
  // group_type can be a number (from search) or an object { id, name } (from detail endpoint)
  const groupTypeValue = group?.group_type;
  const groupTypeName = typeof groupTypeValue === 'object' && groupTypeValue !== null
    ? (groupTypeValue as { name?: string }).name
    : group?.group_type_name;
  const groupTypeLabel = groupTypeName
    ? getGroupTypeLabel(groupTypeName, user)
    : getGroupTypeLabel(group?.type ?? 1, user);

  // Determine button text and state based on request status
  const isPendingRequest = requestStatus === "pending";

  const buttonText = isPendingRequest
    ? "Request Submitted"
    : groupTypeLabel
    ? `Join ${groupTypeLabel}`
    : "Join Dinner Party";

  const handlePress = () => {
    if (!isPending && !isPendingRequest) {
      onPress();
    }
  };

  // Show community message if user is not in community
  const showCommunityMessage = communityName && !isInCommunity && !isPendingRequest;

  return (
    <View style={styles.container}>
      {showCommunityMessage && (
        <View style={styles.communityMessage}>
          <Text style={styles.communityMessageText}>
            Joining this group will also add you to {communityName}
          </Text>
        </View>
      )}
      <TouchableOpacity
        style={[
          styles.button,
          (isPending || isPendingRequest) && styles.buttonDisabled,
          isPendingRequest && styles.buttonRequested,
        ]}
        onPress={handlePress}
        disabled={isPending || isPendingRequest}
        activeOpacity={0.8}
      >
        {isPending ? (
          <ActivityIndicator color="#ffffff" size="small" />
        ) : (
          <Text style={[
            styles.buttonText,
            isPendingRequest && styles.buttonTextRequested,
          ]}>
            {buttonText}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 12,
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderTopColor: "#E5E5E5",
  },
  communityMessage: {
    backgroundColor: "#FFF9E6",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#F5E6B3",
  },
  communityMessageText: {
    fontSize: 14,
    color: "#8B7355",
    textAlign: "center",
    lineHeight: 20,
  },
  button: {
    backgroundColor: "#4A4A4A", // Dark grey matching screenshot
    borderRadius: 8,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 50,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonRequested: {
    backgroundColor: "#9CA3AF", // Grey background for "Request Submitted" state
    opacity: 1,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  buttonTextRequested: {
    color: "#E5E5E5", // Lighter text for requested state
  },
});

