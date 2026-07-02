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
  CrossTeamPermanentMember,
  CrossTeamSyncedRoleMember,
  CrossTeamChannelMembership,
} from "./api/crossTeamChannels";
export {
  createCrossTeamChannelRef,
  updateCrossTeamChannelRef,
  listCrossTeamChannelsRef,
  getCrossTeamChannelMembershipRef,
  addPermanentMemberToChannelRef,
  removePermanentMemberFromChannelRef,
} from "./api/crossTeamChannels";
export { EventEditorScreen } from "./components/EventEditorScreen";
export { EventEditorPanel } from "./components/EventEditorPanel";
export { RunSheetScreen } from "./components/RunSheetScreen";
export { MusicianRehearsalScreen } from "./components/MusicianRehearsalScreen";
export { MyScheduleScreen } from "./components/MyScheduleScreen";
export { MyAvailabilityScreen } from "./components/MyAvailabilityScreen";
export { RosterGridScreen } from "./components/RosterGridScreen";
export { AssignmentDetailScreen } from "./components/AssignmentDetailScreen";
export { RosteringTeamsScreen } from "./components/RosteringTeamsScreen";
export { RosteringCrossTeamScreen } from "./components/RosteringCrossTeamScreen";
export { TemplatesLibraryScreen } from "./components/TemplatesLibraryScreen";
export { TaskTemplateEditorScreen } from "./components/TaskTemplateEditorScreen";
