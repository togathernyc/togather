import { EventTasksScreen } from "@features/scheduling/components/EventTasksScreen";

/**
 * Leader Event Tasks "database view" for an event plan — define the tasks each
 * team/role is accountable for, grouped by segment, with per-task How-To.
 * Gated on `churchFeatures.eventTasksEnabled` + leader role inside the screen.
 */
export default function EventTasksPage() {
  return <EventTasksScreen />;
}
