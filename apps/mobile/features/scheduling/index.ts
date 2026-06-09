/**
 * Scheduling feature — native event scheduling & volunteer rostering.
 *
 * @see /docs/architecture/ADR-023-native-event-scheduling.md
 */
export { TeamSetupScreen } from "./components/TeamSetupScreen";
export { TeamCreateScreen } from "./components/TeamCreateScreen";
export { RolesEditor } from "./components/RolesEditor";
export { CrossTeamSelectorPicker } from "./components/CrossTeamSelectorPicker";
export type {
  CrossTeamSelector,
  CrossTeamChannel,
  EnrichedCrossTeamSelector,
} from "./api/crossTeamChannels";
export {
  createCrossTeamChannelRef,
  updateCrossTeamChannelRef,
  listCrossTeamChannelsRef,
} from "./api/crossTeamChannels";
export { EventListScreen } from "./components/EventListScreen";
export { EventEditorScreen } from "./components/EventEditorScreen";
export { RunSheetScreen } from "./components/RunSheetScreen";
export { MyScheduleScreen } from "./components/MyScheduleScreen";
export { MyAvailabilityScreen } from "./components/MyAvailabilityScreen";
export { AvailabilityGridScreen } from "./components/AvailabilityGridScreen";
export { RosterGridScreen } from "./components/RosterGridScreen";
export { AssignmentDetailScreen } from "./components/AssignmentDetailScreen";

/** Rostering hub — see ADR-024. */
export { RosteringTopTabBar } from "./components/RosteringTopTabBar";
export { RosteringTeamsScreen } from "./components/RosteringTeamsScreen";
export { RosteringCrossTeamScreen } from "./components/RosteringCrossTeamScreen";
