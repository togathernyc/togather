import { useQuery, useAuthenticatedMutation, useAuthenticatedAction, api } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { useState, useCallback } from "react";
import type { Id } from "@services/api/convex";

/** Shape of a team member in slackBotConfig. */
export interface SlackBotTeamMember {
  name: string;
  slackUserId: string;
  roles: string[];
  locations: string[];
}

/** Shape of a nag schedule entry. */
export interface SlackBotNagEntry {
  dayOfWeek: number;
  hourET: number;
  urgency: string;
  label: string;
}

/** Shape of a PCO role mapping. */
export interface PcoRoleMapping {
  teamNamePattern: string;
  positionName: string;
}

/** V2 service plan item shape. */
export interface ServicePlanItemV2 {
  id: string;
  label: string;
  responsibleRoles: string[];
  actionType: string;
  pcoTeamNamePattern?: string;
  pcoPositionName?: string;
  pcoItemTitlePattern?: string;
  pcoItemField?: string;
  preserveSections?: string[];
  aiInstructions?: string;
}

/** Strip items to only mutation-expected fields to avoid Convex strict validator rejection */
export function sanitizeV2Item(item: ServicePlanItemV2): ServicePlanItemV2 {
  const s: Record<string, unknown> = {
    id: item.id,
    label: item.label,
    responsibleRoles: item.responsibleRoles,
    actionType: item.actionType,
  };
  if (item.pcoTeamNamePattern !== undefined) s.pcoTeamNamePattern = item.pcoTeamNamePattern;
  if (item.pcoPositionName !== undefined) s.pcoPositionName = item.pcoPositionName;
  if (item.pcoItemTitlePattern !== undefined) s.pcoItemTitlePattern = item.pcoItemTitlePattern;
  if (item.pcoItemField !== undefined) s.pcoItemField = item.pcoItemField;
  if (item.preserveSections !== undefined) s.preserveSections = item.preserveSections;
  if (item.aiInstructions !== undefined) s.aiInstructions = item.aiInstructions;
  return s as unknown as ServicePlanItemV2;
}

/** PCO team info for dropdowns. */
export interface PcoTeamInfo {
  id: string;
  name: string;
}

/** PCO plan item title for dropdowns. */
export interface PcoPlanItemTitle {
  title: string;
}

/** Slack workspace member (from users.list API) */
export interface SlackMember {
  id: string;
  name: string;
  realName: string;
  displayName: string;
  image: string;
  isBot: boolean;
}

/** Slack channel info for channel picker. */
export interface SlackChannel {
  id: string;
  name: string;
  isMember: boolean;
}

/**
 * Hook for reading and mutating slack bot config.
 */
export function useSlackBotConfig() {
  const { community, token } = useAuth();
  const communityId = community?.id as Id<"communities"> | undefined;

  const config = useQuery(
    api.functions.slackServiceBot.index.getSlackBotConfig,
    communityId && token ? { token, communityId } : "skip"
  );

  const status = useQuery(
    api.functions.slackServiceBot.index.getSlackBotStatus,
    communityId && token ? { token, communityId } : "skip"
  );

  const toggleBot = useAuthenticatedMutation(
    api.functions.slackServiceBot.index.toggleSlackBot
  );

  const updateTeamMembers = useAuthenticatedMutation(
    api.functions.slackServiceBot.index.updateTeamMembers
  );

  const updateThreadMentions = useAuthenticatedMutation(
    api.functions.slackServiceBot.index.updateThreadMentions
  );

  const updateNagSchedule = useAuthenticatedMutation(
    api.functions.slackServiceBot.index.updateNagSchedule
  );

  const updatePrompts = useAuthenticatedMutation(
    api.functions.slackServiceBot.index.updatePrompts
  );

  const updatePcoConfig = useAuthenticatedMutation(
    api.functions.slackServiceBot.index.updatePcoConfig
  );

  const toggleDevMode = useAuthenticatedMutation(
    api.functions.slackServiceBot.index.toggleDevMode
  );

  const updateServicePlanItems = useAuthenticatedMutation(
    api.functions.slackServiceBot.index.updateServicePlanItems
  );

  const updateThreadCreation = useAuthenticatedMutation(
    api.functions.slackServiceBot.index.updateThreadCreation
  );

  const updateSlackChannelId = useAuthenticatedMutation(
    api.functions.slackServiceBot.index.updateSlackChannelId
  );

  const listSlackMembersAction = useAuthenticatedAction(
    api.functions.slackServiceBot.index.listSlackMembers
  );

  const fetchPcoTeamsAndItemsAction = useAuthenticatedAction(
    api.functions.slackServiceBot.index.fetchPcoTeamsAndItems
  );

  const listSlackChannelsAction = useAuthenticatedAction(
    api.functions.slackServiceBot.index.listSlackChannels
  );

  const sendNagAction = useAuthenticatedAction(
    api.functions.slackServiceBot.index.sendNag
  );

  // Cached Slack members for picker
  const [slackMembers, setSlackMembers] = useState<SlackMember[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);

  // Cached PCO teams/items for item editor
  const [pcoTeams, setPcoTeams] = useState<PcoTeamInfo[]>([]);
  const [pcoPlanItemTitles, setPcoPlanItemTitles] = useState<PcoPlanItemTitle[]>([]);
  const [isLoadingPcoData, setIsLoadingPcoData] = useState(false);

  // Cached Slack channels for channel picker
  const [slackChannels, setSlackChannels] = useState<SlackChannel[]>([]);
  const [isLoadingChannels, setIsLoadingChannels] = useState(false);

  const fetchSlackMembers = useCallback(async () => {
    if (!communityId || slackMembers.length > 0) return;
    setIsLoadingMembers(true);
    try {
      const members = await listSlackMembersAction({ communityId });
      setSlackMembers(members as SlackMember[]);
    } catch (error) {
      console.error("Failed to fetch Slack members:", error);
    } finally {
      setIsLoadingMembers(false);
    }
  }, [communityId, slackMembers.length, listSlackMembersAction]);

  const fetchSlackChannels = useCallback(async () => {
    if (!communityId || slackChannels.length > 0) return;
    setIsLoadingChannels(true);
    try {
      const channels = await listSlackChannelsAction({ communityId });
      setSlackChannels(channels as SlackChannel[]);
    } catch (error) {
      console.error("Failed to fetch Slack channels:", error);
    } finally {
      setIsLoadingChannels(false);
    }
  }, [communityId, slackChannels.length, listSlackChannelsAction]);

  const fetchPcoTeamsAndItems = useCallback(async () => {
    if (!communityId || pcoTeams.length > 0) return;
    setIsLoadingPcoData(true);
    try {
      const result = await fetchPcoTeamsAndItemsAction({ communityId });
      setPcoTeams(result.teams as PcoTeamInfo[]);
      setPcoPlanItemTitles(result.planItemTitles as PcoPlanItemTitle[]);
    } catch (error) {
      console.error("Failed to fetch PCO teams/items:", error);
    } finally {
      setIsLoadingPcoData(false);
    }
  }, [communityId, pcoTeams.length, fetchPcoTeamsAndItemsAction]);

  return {
    config,
    status,
    isLoading: config === undefined,
    communityId,
    toggleBot,
    updateTeamMembers,
    updateThreadMentions,
    updateNagSchedule,
    updatePrompts,
    updatePcoConfig,
    toggleDevMode,
    updateServicePlanItems,
    updateThreadCreation,
    updateSlackChannelId,
    slackMembers,
    isLoadingMembers,
    fetchSlackMembers,
    slackChannels,
    isLoadingChannels,
    fetchSlackChannels,
    pcoTeams,
    pcoPlanItemTitles,
    isLoadingPcoData,
    fetchPcoTeamsAndItems,
    sendNag: sendNagAction,
  };
}
