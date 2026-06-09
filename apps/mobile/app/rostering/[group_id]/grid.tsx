import { RosterGridScreen } from "@features/scheduling";

/**
 * Leader roster grid — route `/rostering/[group_id]/grid`.
 * The both-toggle matrix that places volunteers into roles across events
 * (see RosterGridScreen).
 */
export default function RosterGridRoute() {
  return <RosterGridScreen />;
}
