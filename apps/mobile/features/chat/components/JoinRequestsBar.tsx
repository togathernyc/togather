/**
 * JoinRequestsBar
 *
 * Card pinned under the chat toolbar that surfaces pending join requests to
 * the people who can review them (community admins always; group leaders when
 * the group's `joinApprovalMode === "leaders"`). Before this, the only way in
 * was the push notification or a row buried on the group page, so a cleared
 * notification meant a lost request.
 *
 * Renders nothing for everyone else: `countGroupJoinRequests` returns 0 for
 * callers who can't review, so members never see it. With one request the
 * card approves/declines inline; with several it links to the full
 * `/groups/[id]/requests` screen.
 */
import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { formatDistanceToNow } from "date-fns";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";
import { Avatar } from "@components/ui/Avatar";
import { formatError } from "@/utils/error-handling";

type PendingRequest = {
  membershipId: Id<"groupMembers">;
  requestedAt: number;
  user: {
    firstName: string;
    lastName: string;
    profilePhoto: string | null;
  } | null;
};

const MAX_STACKED_AVATARS = 3;

function fullName(request: PendingRequest): string {
  if (!request.user) return "Someone";
  return `${request.user.firstName} ${request.user.lastName}`.trim() || "Someone";
}

function namesSummary(requests: PendingRequest[], total: number): string {
  const first = requests.slice(0, 2).map((r) => r.user?.firstName || "Someone");
  const rest = total - first.length;
  if (rest <= 0) return first.join(" and ");
  return `${first.join(", ")} and ${rest} more`;
}

export function JoinRequestsBar({ groupId }: { groupId: Id<"groups"> }) {
  const router = useRouter();
  const { colors } = useTheme();
  const [processing, setProcessing] = useState(false);

  const count = useAuthenticatedQuery(
    api.functions.groupMembers.countGroupJoinRequests,
    { groupId },
  ) as number | undefined;
  const requests = useAuthenticatedQuery(
    api.functions.groupMembers.listGroupJoinRequests,
    count && count > 0 ? { groupId } : "skip",
  ) as PendingRequest[] | undefined;
  const reviewRequest = useAuthenticatedMutation(
    api.functions.groupMembers.reviewGroupJoinRequest,
  );

  const openRequests = useCallback(() => {
    router.push(`/groups/${groupId}/requests` as any);
  }, [router, groupId]);

  const review = useCallback(
    async (request: PendingRequest, action: "accept" | "decline") => {
      setProcessing(true);
      try {
        await reviewRequest({
          groupId,
          membershipId: request.membershipId,
          action,
        });
      } catch (error) {
        Alert.alert(
          "Couldn't update request",
          formatError(error, "Failed to update the request. Please try again."),
        );
      } finally {
        setProcessing(false);
      }
    },
    [groupId, reviewRequest],
  );

  const confirmDecline = useCallback(
    (request: PendingRequest) => {
      Alert.alert("Decline request?", `Decline ${fullName(request)}'s request to join?`, [
        { text: "Cancel", style: "cancel" },
        { text: "Decline", style: "destructive", onPress: () => review(request, "decline") },
      ]);
    },
    [review],
  );

  if (!count || !requests || requests.length === 0) return null;

  const single = requests.length === 1 ? requests[0] : null;
  const stacked = requests.slice(0, MAX_STACKED_AVATARS);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <TouchableOpacity
        style={styles.summary}
        onPress={openRequests}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="View requests to join"
      >
        <View style={styles.stack}>
          {stacked.map((r, i) => (
            <View
              key={String(r.membershipId)}
              style={[
                styles.stackItem,
                i > 0 && styles.stackOverlap,
                { borderColor: colors.surface },
              ]}
            >
              <Avatar
                name={fullName(r)}
                imageUrl={r.user?.profilePhoto}
                size={single ? 36 : 30}
              />
            </View>
          ))}
        </View>
        <View style={styles.text}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {single
              ? `${fullName(single)} wants to join`
              : `${requests.length} people want to join`}
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={1}>
            {single
              ? `Requested ${formatDistanceToNow(single.requestedAt, { addSuffix: true })}`
              : namesSummary(requests, requests.length)}
          </Text>
        </View>
      </TouchableOpacity>

      {processing ? (
        <ActivityIndicator color={colors.textSecondary} />
      ) : single ? (
        <View style={styles.actions}>
          <TouchableOpacity
            onPress={() => confirmDecline(single)}
            style={[styles.button, { backgroundColor: colors.surfaceSecondary }]}
            accessibilityRole="button"
          >
            <Text style={[styles.buttonText, { color: colors.text }]}>Decline</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => review(single, "accept")}
            style={[styles.button, { backgroundColor: colors.buttonPrimary }]}
            accessibilityRole="button"
          >
            <Text style={[styles.buttonText, { color: colors.buttonPrimaryText }]}>Approve</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          onPress={openRequests}
          style={[styles.button, { backgroundColor: colors.buttonPrimary }]}
          accessibilityRole="button"
        >
          <Text style={[styles.buttonText, { color: colors.buttonPrimaryText }]}>Review</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 10,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  summary: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  stack: { flexDirection: "row" },
  stackItem: { borderWidth: 2, borderRadius: 999 },
  stackOverlap: { marginLeft: -10 },
  text: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, fontWeight: "600" },
  subtitle: { fontSize: 12, marginTop: 1 },
  actions: { flexDirection: "row", gap: 6 },
  button: {
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  buttonText: { fontSize: 13, fontWeight: "600" },
});
