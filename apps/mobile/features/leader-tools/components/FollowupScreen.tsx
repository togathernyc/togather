import React from "react";
import { useLocalSearchParams } from "expo-router";
import { UserRoute } from "@components/guards/UserRoute";
import { useIsDesktopWeb } from "@hooks/useIsDesktopWeb";
import { FollowupDesktopTable } from "./FollowupDesktopTable";
import { FollowupMobileGrid } from "./FollowupMobileGrid";

export {
  SUBTITLE_VARIABLES,
  SUBTITLE_VARIABLE_MAP,
  getScoreValue,
} from "./followupShared";

export function FollowupScreen() {
  const { group_id } = useLocalSearchParams<{ group_id: string }>();
  const isDesktop = useIsDesktopWeb();
  const groupId = group_id || "";

  return (
    <UserRoute>
      {isDesktop ? (
        <FollowupDesktopTable groupId={groupId} />
      ) : (
        <FollowupMobileGrid groupId={groupId} />
      )}
    </UserRoute>
  );
}
