import React, { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams } from "expo-router";

import { useIsDesktopWeb } from "@hooks/useIsDesktopWeb";
import { FollowupDesktopTable } from "./FollowupDesktopTable";
import { FollowupMobileGrid } from "./FollowupMobileGrid";
import { FollowupMobileCards } from "./FollowupMobileCards";

export {
  SUBTITLE_VARIABLES,
  SUBTITLE_VARIABLE_MAP,
  getScoreValue,
} from "./followupShared";

type ViewMode = "cards" | "table";
const VIEW_MODE_KEY = "people_view_mode_v1";

export function FollowupScreen() {
  const { group_id } = useLocalSearchParams<{ group_id: string }>();
  const isDesktop = useIsDesktopWeb();
  const groupId = group_id || "";

  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [viewModeLoaded, setViewModeLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(VIEW_MODE_KEY)
      .then((stored) => {
        if (cancelled) return;
        if (stored === "table" || stored === "cards") setViewMode(stored);
        setViewModeLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setViewModeLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setViewModePersisted = (mode: ViewMode) => {
    setViewMode(mode);
    AsyncStorage.setItem(VIEW_MODE_KEY, mode).catch(() => {});
  };

  if (isDesktop) return <FollowupDesktopTable groupId={groupId} />;
  if (!viewModeLoaded) return null;

  if (viewMode === "cards") {
    return (
      <FollowupMobileCards
        groupId={groupId}
        onSwitchToTable={() => setViewModePersisted("table")}
      />
    );
  }

  return (
    <FollowupMobileGrid
      groupId={groupId}
      onSwitchToCards={() => setViewModePersisted("cards")}
    />
  );
}
