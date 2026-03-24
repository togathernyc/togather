import React from "react";
import { View, ActivityIndicator } from "react-native";
import { useLocalSearchParams, usePathname } from "expo-router";
import { UserRoute } from "@components/guards/UserRoute";
import { useIsDesktopWeb } from "@hooks/useIsDesktopWeb";
import { useAuthenticatedQuery, api } from "@services/api/convex";
import { FollowupDesktopTable } from "@features/leader-tools/components/FollowupDesktopTable";
import { FollowupMobileGrid } from "@features/leader-tools/components/FollowupMobileGrid";

export function PeopleTabScreen() {
  const isDesktop = useIsDesktopWeb();
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const pathname = usePathname();
  const returnToParam =
    typeof params.returnTo === "string" && params.returnTo.trim().length > 0
      ? decodeURIComponent(params.returnTo)
      : null;
  const returnTo = returnToParam && returnToParam !== pathname ? returnToParam : null;

  const crossGroupConfig = useAuthenticatedQuery(
    api.functions.memberFollowups.getCrossGroupConfig,
    {},
  );
  const announcementGroupId = crossGroupConfig?.announcementGroupId ?? "";

  if (!announcementGroupId) {
    return (
      <UserRoute>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator size="large" />
        </View>
      </UserRoute>
    );
  }

  return (
    <UserRoute>
      {isDesktop ? (
        <FollowupDesktopTable groupId={announcementGroupId} defaultAssigneeFilter="me" returnTo={returnTo} />
      ) : (
        <FollowupMobileGrid groupId={announcementGroupId} defaultAssigneeFilter="me" returnTo={returnTo} />
      )}
    </UserRoute>
  );
}
