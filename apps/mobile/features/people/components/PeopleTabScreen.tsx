import React from "react";
import { useLocalSearchParams, usePathname } from "expo-router";
import { UserRoute } from "@components/guards/UserRoute";
import { useIsDesktopWeb } from "@hooks/useIsDesktopWeb";
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

  return (
    <UserRoute>
      {isDesktop ? (
        <FollowupDesktopTable groupId="" crossGroupMode returnTo={returnTo} />
      ) : (
        <FollowupMobileGrid groupId="" crossGroupMode returnTo={returnTo} />
      )}
    </UserRoute>
  );
}
