import React, { useEffect, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, usePathname } from "expo-router";
import { useIsDesktopWeb } from "@hooks/useIsDesktopWeb";
import { useAuthenticatedQuery, api } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { FollowupDesktopTable } from "@features/leader-tools/components/FollowupDesktopTable";
import { FollowupMobileGrid } from "@features/leader-tools/components/FollowupMobileGrid";
import { FollowupMobileCards } from "@features/leader-tools/components/FollowupMobileCards";

type ViewMode = "cards" | "table";
const VIEW_MODE_KEY = "people_view_mode_v1";

export function PeopleTabScreen({
  showAllMembers = false,
}: {
  // Leader-tools People tab (default) pins the roster to the current leader's
  // assigned members. The admin "People" surface passes showAllMembers so
  // admins see the whole community roster (this is the merged Admin → People
  // view — the same check-in roster, unfiltered).
  showAllMembers?: boolean;
} = {}) {
  const isDesktop = useIsDesktopWeb();
  const { user } = useAuth();
  const currentUserId = user?.id;
  const enforcedAssigneeUserId = showAllMembers ? undefined : currentUserId;
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const pathname = usePathname();
  const returnToParam =
    typeof params.returnTo === "string" && params.returnTo.trim().length > 0
      ? decodeURIComponent(params.returnTo)
      : null;
  const returnTo = returnToParam && returnToParam !== pathname ? returnToParam : null;

  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [viewModeLoaded, setViewModeLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(VIEW_MODE_KEY).then((stored) => {
      if (cancelled) return;
      if (stored === "table" || stored === "cards") setViewMode(stored);
      setViewModeLoaded(true);
    }).catch(() => {
      if (!cancelled) setViewModeLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  const setViewModePersisted = (mode: ViewMode) => {
    setViewMode(mode);
    AsyncStorage.setItem(VIEW_MODE_KEY, mode).catch(() => {});
  };

  const crossGroupConfig = useAuthenticatedQuery(
    api.functions.memberFollowups.getCrossGroupConfig,
    {},
  );
  const announcementGroupId = crossGroupConfig?.announcementGroupId ?? "";

  if (!announcementGroupId || !currentUserId || !viewModeLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (isDesktop) {
    return (
      <FollowupDesktopTable
        groupId={announcementGroupId}
        enforcedAssigneeUserId={enforcedAssigneeUserId}
        returnTo={returnTo}
      />
    );
  }

  if (viewMode === "cards") {
    return (
      <FollowupMobileCards
        groupId={announcementGroupId}
        enforcedAssigneeUserId={enforcedAssigneeUserId}
        returnTo={returnTo}
        onSwitchToTable={() => setViewModePersisted("table")}
      />
    );
  }

  return (
    <FollowupMobileGrid
      groupId={announcementGroupId}
      enforcedAssigneeUserId={enforcedAssigneeUserId}
      returnTo={returnTo}
      onSwitchToCards={() => setViewModePersisted("cards")}
    />
  );
}
