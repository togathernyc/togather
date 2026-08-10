/**
 * `/(user)/you/admin/members` — the You tab's "Members" leaf.
 *
 * The admin People surface: `PeopleTabScreen` with `showAllMembers` (whole
 * community roster, not just the current leader's assignees) and `embedded`
 * (this screen's header already applies the top safe-area inset) — exactly the
 * props the legacy `AdminScreen`'s "People" segment passes. Gated by
 * `showCommunityAdmin`; `scroll={false}` because the roster owns its own list.
 * Flag-on only.
 */
import React from "react";
import { YouSubScreen } from "@features/profile/components/YouSubScreen";
import { useYouAdminAccess } from "@features/profile/hooks/useYouAdminAccess";
import { PeopleTabScreen } from "@features/people/components/PeopleTabScreen";

export default function YouAdminMembersRoute() {
  const { ready, showCommunityAdmin } = useYouAdminAccess();
  return (
    <YouSubScreen title="Members" scroll={false} gateReady={ready} allowed={showCommunityAdmin}>
      <PeopleTabScreen showAllMembers embedded />
    </YouSubScreen>
  );
}
