/**
 * Run Sheet Backend Action
 *
 * Provides run sheet data for PCO-integrated groups.
 * Returns formatted plan items with songs, arrangements, notes, and team members.
 *
 * Supports multiple service types per group and allows selecting specific plans.
 */

import { action } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import {
  getValidAccessToken,
  fetchServiceTypes,
  fetchUpcomingPlans,
  fetchPlanItems,
  fetchPlanTimes,
  fetchPlanAllAttachments,
  fetchPlanTeamMembers,
  PcoPlanItem,
  PcoSong,
  PcoArrangement,
  PcoItemNote,
  PcoItemTime,
} from "../../lib/pcoServicesApi";
import { parsePlaceholders, formatNamesList } from "./actions";

// ============================================================================
// Types for the formatted run sheet
// ============================================================================

/**
 * A single item in the run sheet (song, header, media, or generic item)
 */
export interface RunSheetItem {
  id: string;
  type: "song" | "header" | "media" | "item";
  title: string;
  description: string | null;
  sequence: number;
  length: number | null;
  /** Computed start time for this item (ISO string) */
  startsAt: string | null;
  /** Position relative to service: "pre", "post", "during", or null */
  servicePosition: string | null;
  /** Song-specific details (only present for type="song") */
  songDetails?: {
    key: string | null;
    arrangement: string | null;
    author: string | null;
    ccliNumber: string | null;
    bpm: number | null;
    meter: string | null;
  };
  /** Team members assigned to this item (currently not populated by PCO API) */
  assignedPeople: Array<{
    name: string;
    position: string | null;
    team: string | null;
    status: string;
  }>;
  /** Notes attached to this item */
  notes: Array<{
    category: string;
    content: string;
  }>;
  /** Scheduled times for this item */
  times: Array<{
    type: string;
    startsAt: string | null;
  }>;
  /** HTML formatted details from PCO "Detail" tab */
  htmlDetails?: string | null;
  /** Attachments (PDFs, Google Docs, etc.) linked to this item */
  attachments?: Array<{
    id: string;
    filename: string;
    url: string;
    contentType: string;
    linkedUrl: string | null;
  }>;
}

/**
 * Complete run sheet data for a service plan
 */
export interface RunSheet {
  planId: string;
  title: string | null;
  date: string;
  seriesTitle: string | null;
  serviceTypeName: string;
  items: RunSheetItem[];
  /** Available service times for this plan (e.g., 10 AM, 12 PM) */
  serviceTimes: Array<{
    id: string;
    startsAt: string | null;
    name: string;
  }>;
  /** All team members scheduled for this plan */
  teamMembers: Array<{
    name: string;
    position: string | null;
    team: string | null;
    status: string;
  }>;
}

// ============================================================================
// Placeholder Resolution
// ============================================================================

/**
 * Resolve {{ServiceType > Team > Position}} placeholders in a text string
 * using already-fetched team member data.
 */
function resolveTextPlaceholders(
  text: string,
  teamMembers: Array<{
    name: string;
    position: string | null;
    pcoPersonId: string | null;
    teamName: string | null;
    status: string;
  }>,
  serviceTypeName: string
): string {
  const placeholders = parsePlaceholders(text);
  if (placeholders.length === 0) return text;

  let resolved = text;
  for (const placeholder of placeholders) {
    // Only resolve placeholders for this service type
    if (
      placeholder.serviceTypeName.toLowerCase() !==
      serviceTypeName.toLowerCase()
    ) {
      continue;
    }

    const matchingMembers = teamMembers.filter(
      (m) =>
        m.name &&
        m.pcoPersonId && // Has an actual person assigned (not an empty slot)
        m.status !== "D" && // Exclude declined members
        m.teamName?.trim().toLowerCase() === placeholder.teamName.toLowerCase() &&
        m.position?.trim().toLowerCase() ===
          placeholder.positionName.toLowerCase()
    );

    const firstNames = matchingMembers.map((m) => m.name.split(" ")[0]);
    const replacement =
      firstNames.length > 0 ? formatNamesList(firstNames) : "[TBD]";
    resolved = resolved.replace(placeholder.fullMatch, replacement);
  }

  return resolved;
}

/**
 * Resolve placeholders in all item descriptions and note content.
 */
function resolvePlaceholdersInItems(
  items: RunSheetItem[],
  teamMembers: Array<{
    name: string;
    position: string | null;
    pcoPersonId: string | null;
    teamName: string | null;
    status: string;
  }>,
  serviceTypeName: string
): RunSheetItem[] {
  return items.map((item) => ({
    ...item,
    description: item.description
      ? resolveTextPlaceholders(item.description, teamMembers, serviceTypeName)
      : item.description,
    notes: item.notes.map((note) => ({
      ...note,
      content: resolveTextPlaceholders(
        note.content,
        teamMembers,
        serviceTypeName
      ),
    })),
  }));
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Resource lookup maps for PCO included resources
 */
interface ResourceLookups {
  songLookup: Map<string, PcoSong>;
  arrangementLookup: Map<string, PcoArrangement>;
  noteLookup: Map<string, PcoItemNote>;
  timeLookup: Map<string, PcoItemTime>;
}

/**
 * Build lookup maps from PCO included resources
 */
function buildResourceLookups(
  included: Array<{ type: string; id: string; attributes: unknown }> | undefined
): ResourceLookups {
  const songLookup = new Map<string, PcoSong>();
  const arrangementLookup = new Map<string, PcoArrangement>();
  const noteLookup = new Map<string, PcoItemNote>();
  const timeLookup = new Map<string, PcoItemTime>();

  for (const item of included ?? []) {
    switch (item.type) {
      case "Song":
        songLookup.set(item.id, item as PcoSong);
        break;
      case "Arrangement":
        arrangementLookup.set(item.id, item as PcoArrangement);
        break;
      case "ItemNote":
        noteLookup.set(item.id, item as PcoItemNote);
        break;
      case "ItemTime":
        timeLookup.set(item.id, item as PcoItemTime);
        break;
    }
  }

  return { songLookup, arrangementLookup, noteLookup, timeLookup };
}

/** Attachment data mapped by item ID */
type AttachmentsByItemId = Map<
  string,
  Array<{
    id: string;
    filename: string;
    url: string;
    contentType: string;
    linkedUrl: string | null;
  }>
>;

/**
 * Format PCO plan items into RunSheetItem array
 */
function formatPlanItems(
  data: PcoPlanItem[],
  lookups: ResourceLookups,
  attachmentsByItemId: AttachmentsByItemId
): RunSheetItem[] {
  const { songLookup, arrangementLookup, noteLookup, timeLookup } = lookups;

  const formattedItems: RunSheetItem[] = data.map((item: PcoPlanItem) => {
    const itemType = item.attributes.item_type as RunSheetItem["type"];

    // Get song details if this is a song
    let songDetails: RunSheetItem["songDetails"];
    let songTitle: string | null = null;

    if (itemType === "song" && item.relationships?.song?.data) {
      const song = songLookup.get(item.relationships.song.data.id);
      const arrangement = item.relationships?.arrangement?.data
        ? arrangementLookup.get(item.relationships.arrangement.data.id)
        : undefined;

      songTitle = song?.attributes.title ?? null;

      // Use item's key_name if set, otherwise fall back to arrangement's chord_chart_key
      // PCO allows overriding the key per-item in the plan
      const key = item.attributes.key_name ?? arrangement?.attributes.chord_chart_key ?? null;

      songDetails = {
        key,
        arrangement: arrangement?.attributes.name ?? null,
        author: song?.attributes.author ?? null,
        ccliNumber: song?.attributes.ccli_number ?? null,
        bpm: arrangement?.attributes.bpm ?? null,
        meter: arrangement?.attributes.meter ?? null,
      };
    }

    // Get notes for this item
    const notes: RunSheetItem["notes"] = [];
    if (item.relationships?.item_notes?.data) {
      for (const noteRef of item.relationships.item_notes.data) {
        const note = noteLookup.get(noteRef.id);
        if (note?.attributes.content) {
          notes.push({
            category: note.attributes.category_name,
            content: note.attributes.content,
          });
        }
      }
    }

    // Get times for this item
    const times: RunSheetItem["times"] = [];
    if (item.relationships?.item_times?.data) {
      for (const timeRef of item.relationships.item_times.data) {
        const time = timeLookup.get(timeRef.id);
        if (time) {
          times.push({
            type: time.attributes.time_type,
            startsAt: time.attributes.starts_at,
          });
        }
      }
    }

    // Get attachments from the separately-fetched attachments map
    const attachments = attachmentsByItemId.get(item.id);

    // Use song title from library if available, otherwise use item title
    const displayTitle = songTitle || item.attributes.title;

    return {
      id: item.id,
      type: itemType,
      title: displayTitle,
      description: item.attributes.description,
      htmlDetails: item.attributes.html_details,
      sequence: item.attributes.sequence,
      length: item.attributes.length,
      startsAt: null, // Computed after sorting by computeItemStartTimes
      servicePosition: item.attributes.service_position,
      songDetails,
      assignedPeople: [], // PCO doesn't link items to specific team members directly
      notes,
      times,
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
    };
  });

  // Sort by sequence
  formattedItems.sort((a, b) => a.sequence - b.sequence);

  return formattedItems;
}

/**
 * Compute start times for items based on the service start time and cumulative durations.
 * Walks items in sequence order, accumulating durations to derive each item's start time.
 *
 * - "during" items: accumulate from the service start time
 * - "pre" items: count backwards from the service start (accumulated in reverse)
 * - "post" items: continue accumulating after the last "during" item
 * - Headers get the start time of the next non-header item
 *
 * NOTE: This logic is duplicated in the frontend (RunSheetScreen.tsx#recomputeItemStartTimes)
 * for instant client-side service time switching. If this algorithm changes, update both copies.
 */
function computeItemStartTimes(
  items: RunSheetItem[],
  serviceStartTime: string | null
): void {
  if (!serviceStartTime) return;

  const serviceStart = new Date(serviceStartTime).getTime();

  // Separate items by service position
  // Items are already sorted by sequence
  const preItems: RunSheetItem[] = [];
  const duringAndPostItems: RunSheetItem[] = [];

  // Track current section — items after a header inherit its service_position
  let currentSection: string | null = null;

  for (const item of items) {
    if (item.type === "header") {
      // Headers define sections; their servicePosition sets the section context
      currentSection = item.servicePosition;
    }

    // Determine the effective position: item's own, or inherited from section header
    const effectivePosition = item.servicePosition || currentSection;

    if (effectivePosition === "pre") {
      preItems.push(item);
    } else {
      duringAndPostItems.push(item);
    }
  }

  // Compute pre-service items (count backwards from service start)
  // Walk in reverse to accumulate durations
  let preTime = serviceStart;
  for (let i = preItems.length - 1; i >= 0; i--) {
    const item = preItems[i];
    if (item.type === "header") continue; // Set header times after
    const duration = (item.length ?? 0) * 1000;
    preTime -= duration;
    item.startsAt = new Date(preTime).toISOString();
  }

  // Set header times for pre items (header gets the time of the next non-header item)
  for (let i = 0; i < preItems.length; i++) {
    if (preItems[i].type === "header") {
      // Find the next non-header item
      for (let j = i + 1; j < preItems.length; j++) {
        if (preItems[j].type !== "header" && preItems[j].startsAt) {
          preItems[i].startsAt = preItems[j].startsAt;
          break;
        }
      }
    }
  }

  // Compute during/post items (accumulate from service start)
  let currentTime = serviceStart;
  for (const item of duringAndPostItems) {
    if (item.type === "header") continue; // Set header times after
    item.startsAt = new Date(currentTime).toISOString();
    currentTime += (item.length ?? 0) * 1000;
  }

  // Set header times for during/post items
  for (let i = 0; i < duringAndPostItems.length; i++) {
    if (duringAndPostItems[i].type === "header") {
      for (let j = i + 1; j < duringAndPostItems.length; j++) {
        if (duringAndPostItems[j].type !== "header" && duringAndPostItems[j].startsAt) {
          duringAndPostItems[i].startsAt = duringAndPostItems[j].startsAt;
          break;
        }
      }
    }
  }
}

// ============================================================================
// Types for Multi-Service Support
// ============================================================================

/**
 * Compact plan info for service type listing
 */
export interface UpcomingPlanInfo {
  id: string;
  title: string | null;
  date: string;
  seriesTitle: string | null;
}

/**
 * Service type with its upcoming plans
 */
export interface ServiceTypeWithPlans {
  id: string;
  name: string;
  upcomingPlans: UpcomingPlanInfo[];
}

// ============================================================================
// Multi-Service Actions
// ============================================================================

/**
 * Get all available service types configured for a group.
 *
 * Looks at all auto-channel configs for the group's channels to find
 * which PCO service types are configured, then fetches upcoming plans for each.
 *
 * @param token - User authentication token
 * @param groupId - The group to get service types for
 * @returns Array of service types with their upcoming plans
 */
export const getAvailableServiceTypes = action({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args): Promise<ServiceTypeWithPlans[]> => {
    // 1. Verify access (any group member can view run sheet) and get community info
    const { communityId } = await ctx.runMutation(
      internal.functions.pcoServices.actions.verifyGroupMemberAccess,
      { token: args.token, groupId: args.groupId }
    );

    // 2. Get the community's PCO integration
    const accessToken = await getValidAccessToken(ctx, communityId);
    if (!accessToken) {
      throw new Error("No valid PCO integration found for this community");
    }

    // 3. Get all channels for this group and their auto-channel configs
    const channels = await ctx.runQuery(
      internal.functions.pcoServices.actions.getChannelsForGroup,
      { groupId: args.groupId }
    );

    // 4. Collect all configured service types (deduplicated)
    const serviceTypeMap = new Map<string, string>(); // id -> name

    for (const channel of channels) {
      const config = await ctx.runQuery(
        internal.functions.pcoServices.rotation.getAutoChannelConfig,
        { channelId: channel._id }
      );

      if (config?.config.filters?.serviceTypeIds) {
        const ids = config.config.filters.serviceTypeIds;
        const names = config.config.filters.serviceTypeNames || [];

        for (let i = 0; i < ids.length; i++) {
          if (!serviceTypeMap.has(ids[i])) {
            serviceTypeMap.set(ids[i], names[i] || "Service");
          }
        }
      }

      // Legacy single service type config
      if (config?.config.serviceTypeId && !serviceTypeMap.has(config.config.serviceTypeId)) {
        serviceTypeMap.set(
          config.config.serviceTypeId,
          config.config.serviceTypeName || "Service"
        );
      }
    }

    if (serviceTypeMap.size === 0) {
      return [];
    }

    // 5. Fetch upcoming plans for each service type
    const result: ServiceTypeWithPlans[] = [];

    for (const [serviceTypeId, name] of serviceTypeMap) {
      const plans = await fetchUpcomingPlans(accessToken, serviceTypeId, 5);

      result.push({
        id: serviceTypeId,
        name,
        upcomingPlans: plans.map((p) => ({
          id: p.id,
          title: p.attributes.title || null,
          date: p.attributes.sort_date,
          seriesTitle: p.attributes.series_title,
        })),
      });
    }

    return result;
  },
});

/**
 * Get run sheet for a specific service type and optional plan.
 *
 * If no serviceTypeId is provided, uses the group's default from runSheetConfig.
 * If no planId is provided, uses the first upcoming plan.
 *
 * @param token - User authentication token
 * @param groupId - The group to get the run sheet for
 * @param serviceTypeId - Optional service type ID (uses default if not provided)
 * @param planId - Optional plan ID (uses first upcoming if not provided)
 * @returns RunSheet data or null if no upcoming plans
 */
export const getRunSheet = action({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    serviceTypeId: v.optional(v.string()),
    planId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<RunSheet | null> => {
    // 1. Verify access (any group member can view run sheet) and get community info
    const { communityId } = await ctx.runMutation(
      internal.functions.pcoServices.actions.verifyGroupMemberAccess,
      { token: args.token, groupId: args.groupId }
    );

    // 2. Get the community's PCO integration
    const accessToken = await getValidAccessToken(ctx, communityId);
    if (!accessToken) {
      throw new Error("No valid PCO integration found for this community");
    }

    // 3. Get the group to find service type configuration or defaults
    const group = await ctx.runQuery(
      internal.functions.groups.internal.getByIdInternal,
      { groupId: args.groupId }
    );
    if (!group) {
      throw new Error("Group not found");
    }

    // 4. Determine the service type to use
    let serviceTypeId = args.serviceTypeId;
    let serviceTypeName = "";

    // If not provided, try to use default from runSheetConfig
    if (!serviceTypeId && group.runSheetConfig?.defaultServiceTypeIds?.[0]) {
      serviceTypeId = group.runSheetConfig.defaultServiceTypeIds[0];
    }

    // If still not set, find from auto channel configs
    if (!serviceTypeId) {
      const channels = await ctx.runQuery(
        internal.functions.pcoServices.actions.getChannelsForGroup,
        { groupId: args.groupId }
      );

      for (const channel of channels) {
        const config = await ctx.runQuery(
          internal.functions.pcoServices.rotation.getAutoChannelConfig,
          { channelId: channel._id }
        );

        if (config?.config.filters?.serviceTypeIds?.[0]) {
          serviceTypeId = config.config.filters.serviceTypeIds[0];
          serviceTypeName = config.config.filters.serviceTypeNames?.[0] || "Service";
          break;
        }

        if (config?.config.serviceTypeId) {
          serviceTypeId = config.config.serviceTypeId;
          serviceTypeName = config.config.serviceTypeName || "Service";
          break;
        }
      }
    }

    if (!serviceTypeId) {
      throw new Error(
        "No PCO service type configured. Please set up PCO sync for this group first."
      );
    }

    // Look up service type name if we don't have it yet
    if (!serviceTypeName) {
      const serviceTypes = await fetchServiceTypes(accessToken);
      const serviceType = serviceTypes.find((st) => st.id === serviceTypeId);
      serviceTypeName = serviceType?.attributes.name.trim() || "Service";
    }

    // 5. Fetch upcoming plans
    const plans = await fetchUpcomingPlans(accessToken, serviceTypeId, 10);
    if (plans.length === 0) {
      return null;
    }

    // 6. Select the plan to show
    let plan = plans[0]; // Default to first upcoming
    if (args.planId) {
      const requestedPlan = plans.find((p) => p.id === args.planId);
      if (requestedPlan) {
        plan = requestedPlan;
      }
    }

    // 7. Fetch plan items with includes
    const itemsResponse = await fetchPlanItems(
      accessToken,
      serviceTypeId,
      plan.id
    );

    // 8. Fetch all attachments for the plan (PCO requires separate endpoint)
    const attachmentsResponse = await fetchPlanAllAttachments(
      accessToken,
      serviceTypeId,
      plan.id
    );

    // 9. Build a map of item ID -> attachments
    const attachmentsByItemId: AttachmentsByItemId = new Map();
    for (const attachment of attachmentsResponse.data) {
      if (attachment.attributes.attachable_type === "Item") {
        const itemId = attachment.attributes.attachable_id;
        if (!attachmentsByItemId.has(itemId)) {
          attachmentsByItemId.set(itemId, []);
        }
        attachmentsByItemId.get(itemId)!.push({
          id: attachment.id,
          filename: attachment.attributes.filename,
          url: attachment.attributes.url,
          contentType: attachment.attributes.content_type,
          linkedUrl: attachment.attributes.linked_url,
        });
      }
    }

    // 10. Fetch team members for the plan (paginated to get ALL members)
    const teamMembers = await fetchPlanTeamMembers(
      accessToken,
      serviceTypeId,
      plan.id
    );

    // 11. Build lookup maps and format items using helpers
    const lookups = buildResourceLookups(itemsResponse.included);
    const formattedItems = formatPlanItems(itemsResponse.data, lookups, attachmentsByItemId);

    // 12. Fetch plan times for service time selector and start time computation
    const planTimes = await fetchPlanTimes(accessToken, serviceTypeId, plan.id);
    const serviceTimes = planTimes
      .filter((t) => t.timeType === "service")
      .map((t) => ({ id: t.id, startsAt: t.startsAt, name: t.name }));

    // Compute start times using the first service time as default
    const defaultServiceStart = serviceTimes[0]?.startsAt ?? null;
    computeItemStartTimes(formattedItems, defaultServiceStart);

    // 13. Resolve {{ServiceType > Team > Position}} placeholders in item notes and descriptions
    const resolvedItems = resolvePlaceholdersInItems(formattedItems, teamMembers, serviceTypeName);

    return {
      planId: plan.id,
      title: plan.attributes.title || null,
      date: plan.attributes.sort_date,
      seriesTitle: plan.attributes.series_title,
      serviceTypeName,
      serviceTimes,
      items: resolvedItems,
      teamMembers: teamMembers.map((m) => ({
        name: m.name,
        position: m.position,
        team: m.teamName,
        status: m.status,
      })),
    };
  },
});

/**
 * Public version of getRunSheet — no auth required.
 * Used by resource short link pages (togather.nyc/r/[shortId]).
 * Requires a valid shortLinkId to verify access originates from a short link.
 * Looks up the group's community directly to get PCO credentials.
 */
export const getRunSheetPublic = action({
  args: {
    groupId: v.id("groups"),
    shortLinkId: v.string(),
  },
  handler: async (ctx, args): Promise<RunSheet | null> => {
    // 0. Verify the short link is valid for this group and tool type
    const isValid = await ctx.runQuery(
      internal.functions.toolShortLinks.index.verifyShortLink,
      {
        shortLinkId: args.shortLinkId,
        toolType: "runsheet",
        groupId: args.groupId,
      }
    );
    if (!isValid) {
      return null;
    }

    // 1. Get the group directly (no auth)
    const group = await ctx.runQuery(
      internal.functions.groups.internal.getByIdInternal,
      { groupId: args.groupId }
    );
    if (!group || group.isArchived) {
      return null;
    }

    // 2. Get the community's PCO integration
    const accessToken = await getValidAccessToken(ctx, group.communityId);
    if (!accessToken) {
      return null; // No PCO integration — return null instead of throwing
    }

    // 3. Determine the service type to use
    let serviceTypeId: string | undefined;
    let serviceTypeName = "";

    // Try default from runSheetConfig
    if (group.runSheetConfig?.defaultServiceTypeIds?.[0]) {
      serviceTypeId = group.runSheetConfig.defaultServiceTypeIds[0];
    }

    // If still not set, find from auto channel configs
    if (!serviceTypeId) {
      const channels = await ctx.runQuery(
        internal.functions.pcoServices.actions.getChannelsForGroup,
        { groupId: args.groupId }
      );

      for (const channel of channels) {
        const config = await ctx.runQuery(
          internal.functions.pcoServices.rotation.getAutoChannelConfig,
          { channelId: channel._id }
        );

        if (config?.config.filters?.serviceTypeIds?.[0]) {
          serviceTypeId = config.config.filters.serviceTypeIds[0];
          serviceTypeName = config.config.filters.serviceTypeNames?.[0] || "Service";
          break;
        }

        if (config?.config.serviceTypeId) {
          serviceTypeId = config.config.serviceTypeId;
          serviceTypeName = config.config.serviceTypeName || "Service";
          break;
        }
      }
    }

    if (!serviceTypeId) {
      return null; // No PCO service type configured
    }

    // Look up service type name if we don't have it yet
    if (!serviceTypeName) {
      const serviceTypes = await fetchServiceTypes(accessToken);
      const serviceType = serviceTypes.find((st) => st.id === serviceTypeId);
      serviceTypeName = serviceType?.attributes.name.trim() || "Service";
    }

    // 4. Fetch upcoming plans
    const plans = await fetchUpcomingPlans(accessToken, serviceTypeId, 10);
    if (plans.length === 0) {
      return null;
    }

    const plan = plans[0];

    // 5. Fetch plan items with includes
    const itemsResponse = await fetchPlanItems(
      accessToken,
      serviceTypeId,
      plan.id
    );

    // 6. Fetch all attachments for the plan
    const attachmentsResponse = await fetchPlanAllAttachments(
      accessToken,
      serviceTypeId,
      plan.id
    );

    // 7. Build a map of item ID -> attachments
    const attachmentsByItemId: AttachmentsByItemId = new Map();
    for (const attachment of attachmentsResponse.data) {
      if (attachment.attributes.attachable_type === "Item") {
        const itemId = attachment.attributes.attachable_id;
        if (!attachmentsByItemId.has(itemId)) {
          attachmentsByItemId.set(itemId, []);
        }
        attachmentsByItemId.get(itemId)!.push({
          id: attachment.id,
          filename: attachment.attributes.filename,
          url: attachment.attributes.url,
          contentType: attachment.attributes.content_type,
          linkedUrl: attachment.attributes.linked_url,
        });
      }
    }

    // 8. Fetch team members for the plan (paginated to get ALL members)
    const teamMembers = await fetchPlanTeamMembers(
      accessToken,
      serviceTypeId,
      plan.id
    );

    // 9. Build lookup maps and format items
    const lookups = buildResourceLookups(itemsResponse.included);
    const formattedItems = formatPlanItems(itemsResponse.data, lookups, attachmentsByItemId);

    // 10. Fetch plan times for service time selector and start time computation
    const planTimes = await fetchPlanTimes(accessToken, serviceTypeId, plan.id);
    const serviceTimes = planTimes
      .filter((t) => t.timeType === "service")
      .map((t) => ({ id: t.id, startsAt: t.startsAt, name: t.name }));

    const defaultServiceStart = serviceTimes[0]?.startsAt ?? null;
    computeItemStartTimes(formattedItems, defaultServiceStart);

    // 11. Resolve {{ServiceType > Team > Position}} placeholders in item notes and descriptions
    const resolvedItems = resolvePlaceholdersInItems(formattedItems, teamMembers, serviceTypeName);

    return {
      planId: plan.id,
      title: plan.attributes.title || null,
      date: plan.attributes.sort_date,
      seriesTitle: plan.attributes.series_title,
      serviceTypeName,
      serviceTimes,
      items: resolvedItems,
      teamMembers: teamMembers.map((m) => ({
        name: m.name,
        position: m.position,
        team: m.teamName,
        status: m.status,
      })),
    };
  },
});
