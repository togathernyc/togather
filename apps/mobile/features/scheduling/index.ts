/**
 * Scheduling feature — native event scheduling & volunteer rostering.
 *
 * @see /docs/architecture/ADR-023-native-event-scheduling.md
 */
export { TeamSetupScreen } from "./components/TeamSetupScreen";
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
export { MyScheduleScreen } from "./components/MyScheduleScreen";
export { AssignmentDetailScreen } from "./components/AssignmentDetailScreen";
