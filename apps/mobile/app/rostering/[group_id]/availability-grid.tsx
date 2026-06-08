import { AvailabilityGridScreen } from "@features/scheduling";

/**
 * Leader availability grid — route `/rostering/[group_id]/availability-grid`.
 * The roster-vs-events matrix view (see AvailabilityGridScreen).
 */
export default function AvailabilityGridRoute() {
  return <AvailabilityGridScreen />;
}
