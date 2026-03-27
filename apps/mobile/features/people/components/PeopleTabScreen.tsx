import React from "react";
import { View, ActivityIndicator } from "react-native";
import { useLocalSearchParams, usePathname } from "expo-router";
import { useIsDesktopWeb } from "@hooks/useIsDesktopWeb";
import { useAuthenticatedQuery, api } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { FollowupDesktopTable } from "@features/leader-tools/components/FollowupDesktopTable";
import { FollowupMobileGrid } from "@features/leader-tools/components/FollowupMobileGrid";

export function PeopleTabScreen() {
  const isDesktop = useIsDesktopWeb();
  const { user } = useAuth();
  const currentUserId = user?.id;
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

  if (!announcementGroupId || !currentUserId) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <>
      {isDesktop ? (
        <FollowupDesktopTable groupId={announcementGroupId} enforcedAssigneeUserId={currentUserId} returnTo={returnTo} />
      ) : (
        <FollowupMobileGrid groupId={announcementGroupId} enforcedAssigneeUserId={currentUserId} returnTo={returnTo} />
      )}
    </>
  );
}
