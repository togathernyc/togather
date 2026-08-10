import { AssignmentDetailScreen } from "@features/scheduling";

/**
 * Deep-link target for assignment requests:
 *   /scheduling/assignment/[id]
 *
 * Push + SMS notifications from `scheduling.publishEvent` point here so a
 * tapped request opens straight to the volunteer's accept/decline screen.
 */
export default function AssignmentDetailRoute() {
  return <AssignmentDetailScreen />;
}
