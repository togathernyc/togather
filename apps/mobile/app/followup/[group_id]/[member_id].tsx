import { FollowupDetailScreen } from "@features/leader-tools/components/FollowupDetailScreen";

// Notification route: the followup_assigned push payload carries an
// Id<"groupMembers">, not an Id<"communityPeople">, so tell the screen which
// arm of the communityPeople.history query to call.
export default function FollowupNotificationRoute() {
  return <FollowupDetailScreen memberIdKind="groupMember" />;
}
