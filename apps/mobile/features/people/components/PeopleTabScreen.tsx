import React from "react";
import { View, ActivityIndicator, Platform } from "react-native";
import { useLocalSearchParams, usePathname } from "expo-router";
import { useAuthenticatedQuery, api, Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { FollowupDesktopTable } from "@features/leader-tools/components/FollowupDesktopTable";
import { FollowupMobileCards } from "@features/leader-tools/components/FollowupMobileCards";

export function PeopleTabScreen({
  showAllMembers = false,
}: {
  // Leader-tools People tab (default) pins the roster to the current leader's
  // assigned members. The admin "People" surface passes showAllMembers so
  // admins see the whole community roster (this is the merged Admin → People
  // view — the same check-in roster, unfiltered).
  showAllMembers?: boolean;
} = {}) {
  const { user, community } = useAuth();
  const currentUserId = user?.id;
  const communityId = community?.id as Id<"communities"> | undefined;
  const enforcedAssigneeUserId = showAllMembers ? undefined : currentUserId;
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const pathname = usePathname();
  const returnToParam =
    typeof params.returnTo === "string" && params.returnTo.trim().length > 0
      ? decodeURIComponent(params.returnTo)
      : null;
  const returnTo = returnToParam && returnToParam !== pathname ? returnToParam : null;

  const crossGroupConfig = useAuthenticatedQuery(
    api.functions.memberFollowups.getCrossGroupConfig,
    communityId ? { communityId } : "skip",
  );
  const announcementGroupId = crossGroupConfig?.announcementGroupId ?? "";

  if (!announcementGroupId || !currentUserId) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // Fixed per platform (no in-app toggle): web shows the list/table, native
  // shows the tile/card view.
  if (Platform.OS === "web") {
    return (
      <FollowupDesktopTable
        groupId={announcementGroupId}
        enforcedAssigneeUserId={enforcedAssigneeUserId}
        returnTo={returnTo}
      />
    );
  }

  return (
    <FollowupMobileCards
      groupId={announcementGroupId}
      enforcedAssigneeUserId={enforcedAssigneeUserId}
      returnTo={returnTo}
      hideHeader
    />
  );
}
