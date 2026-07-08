import React from "react";
import { Platform } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { FollowupDesktopTable } from "./FollowupDesktopTable";
import { FollowupMobileCards } from "./FollowupMobileCards";

export {
  SUBTITLE_VARIABLES,
  SUBTITLE_VARIABLE_MAP,
  getScoreValue,
} from "./followupShared";

export function FollowupScreen() {
  const { group_id } = useLocalSearchParams<{ group_id: string }>();
  const groupId = group_id || "";

  // Fixed per platform (no in-app toggle): web shows the list/table, native
  // shows the tile/card view. The group-scoped check-in keeps its header so the
  // back button and group name stay available.
  if (Platform.OS === "web") return <FollowupDesktopTable groupId={groupId} />;
  return <FollowupMobileCards groupId={groupId} />;
}
