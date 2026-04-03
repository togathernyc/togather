/**
 * Wrapper that fetches a reach-out request by ID and renders
 * the leader variant of ReachOutRequestCard.
 *
 * Used inside MessageItem when contentType === "reach_out_request".
 */

import React from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import type { Id } from "@services/api/convex";
import { useQuery, api } from "@services/api/convex";
import { useStoredAuthToken } from "@services/api/convex";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { ReachOutRequestCard } from "./ReachOutRequestCard";

interface Props {
  requestId: Id<"reachOutRequests">;
  groupId?: Id<"groups">;
}

export function ReachOutRequestCardFromMessage({ requestId, groupId }: Props) {
  const token = useStoredAuthToken();
  const { primaryColor } = useCommunityTheme();

  const request = useQuery(
    api.functions.messaging.reachOut.getRequestDetail,
    token ? { token, requestId } : "skip"
  );

  const leaders = useQuery(
    api.functions.messaging.reachOut.getGroupLeaders,
    token && groupId ? { token, groupId } : "skip"
  );

  if (request === undefined) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="small" color={primaryColor} />
      </View>
    );
  }

  if (!request) return null;

  return (
    <View style={styles.container}>
      <ReachOutRequestCard
        request={request}
        variant="leader"
        groupId={groupId}
        leaders={leaders?.filter((l): l is NonNullable<typeof l> => l !== null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    // No extra padding — parent MessageItem handles spacing
  },
  loading: {
    padding: 16,
    alignItems: "center",
  },
});
