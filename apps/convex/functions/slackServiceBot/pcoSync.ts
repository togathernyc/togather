/**
 * FOUNT Service Planning Bot - PCO Sync
 *
 * Write-back to Planning Center when service info is collected from Slack.
 *
 * Uses existing PCO OAuth infra (getValidAccessToken, pcoFetch) from
 * apps/convex/lib/pcoServicesApi.ts.
 */

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { Id } from "../../_generated/dataModel";
import {
  getValidAccessToken,
  pcoFetch,
  fetchUpcomingPlans,
  fetchPlanItems,
  fetchPlanTeamMembers,
  fetchTeamsForServiceType,
  searchPeopleByName,
  type PcoPlanItem,
  type PcoPlanItemsResponse,
  type PcoItemNote,
} from "../../lib/pcoServicesApi";
import {
  PCO_COMMUNITY_ID,
  PCO_SERVICE_TYPE_IDS,
  PCO_ROLE_MAPPINGS,
} from "./config";
import { ActionCtx } from "../../_generated/server";
import { Doc } from "../../_generated/dataModel";

const PCO_SERVICES_BASE = "https://api.planningcenteronline.com/services/v2";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get a valid PCO access token using the configured community's OAuth credentials.
 */
async function getPcoAccessToken(ctx: ActionCtx): Promise<string> {
  const communityId = PCO_COMMUNITY_ID as Id<"communities">;
  return await getValidAccessToken(ctx, communityId);
}

/**
 * Get the PCO plan for the upcoming Sunday at a given location.
 * Returns the plan ID or null if not found.
 */
async function getUpcomingSundayPlan(
  ctx: ActionCtx,
  location: string
): Promise<{ planId: string; serviceTypeId: string } | null> {
  const serviceTypeId = PCO_SERVICE_TYPE_IDS[location];

  if (!serviceTypeId) {
    console.warn(`[PCO Sync] No service type ID for location: ${location}`);
    return null;
  }

  const accessToken = await getPcoAccessToken(ctx);
  const plans = await fetchUpcomingPlans(accessToken, serviceTypeId, 1);

  if (plans.length === 0) {
    console.warn(`[PCO Sync] No upcoming plans for ${location}`);
    return null;
  }

  return { planId: plans[0].id, serviceTypeId };
}

/**
 * Look up a PCO person ID by name via the People API.
 * If no match is found, creates a new PCO person so that
 * downstream features (run sheets, etc.) still work even for
 * guests or non-members.
 */
async function findOrCreatePcoPerson(
  accessToken: string,
  name: string
): Promise<string | null> {
  // Search PCO People API
  try {
    const results = await searchPeopleByName(accessToken, name);

    if (results.length > 0) {
      console.log(
        `[PCO Sync] Found PCO person for "${name}": ${results[0].firstName} ${results[0].lastName} (ID: ${results[0].id})`
      );
      return results[0].id;
    }
  } catch (error) {
    console.error(`[PCO Sync] Error searching for person "${name}":`, error);
    return null;
  }

  // No match found — create a new PCO person (guest/non-member)
  try {
    const nameParts = name.trim().split(/\s+/);
    const firstName = nameParts[0] || name;
    const lastName = nameParts.slice(1).join(" ") || "";

    const created = await pcoFetch<{
      data: { id: string; type: "Person" };
    }>(
      accessToken,
      "https://api.planningcenteronline.com/people/v2/people",
      {
        method: "POST",
        body: JSON.stringify({
          data: {
            type: "Person",
            attributes: {
              first_name: firstName,
              last_name: lastName,
            },
          },
        }),
      }
    );

    console.log(
      `[PCO Sync] Created PCO person for "${name}" (ID: ${created.data.id})`
    );
    return created.data.id;
  } catch (error) {
    console.error(`[PCO Sync] Error creating PCO person "${name}":`, error);
    return null;
  }
}

/**
 * Find the PCO team ID for a role by searching the service type's teams.
 * Matches team name against the configured pattern (case-insensitive).
 */
async function findTeamForRole(
  accessToken: string,
  serviceTypeId: string,
  role: string
): Promise<string | null> {
  const mapping = PCO_ROLE_MAPPINGS[role];
  if (!mapping) {
    console.warn(`[PCO Sync] No role mapping for: ${role}`);
    return null;
  }

  const teams = await fetchTeamsForServiceType(accessToken, serviceTypeId);
  const pattern = mapping.teamNamePattern.toLowerCase();
  const match = teams.find((t) =>
    t.attributes.name.toLowerCase().includes(pattern)
  );

  if (!match) {
    console.warn(
      `[PCO Sync] No team matching "${pattern}" found for service type ${serviceTypeId}. Available: ${teams.map((t) => t.attributes.name).join(", ")}`
    );
    return null;
  }

  return match.id;
}

// ============================================================================
// Core Functions (plain async, callable from tools.ts with DB config)
// ============================================================================

/** PCO config shape from the DB */
type PcoDbConfig = Doc<"slackBotConfig">["pcoConfig"];

/**
 * Get the PCO plan for the upcoming Sunday at a given location, using DB config.
 */
async function getUpcomingSundayPlanFromConfig(
  ctx: ActionCtx,
  location: string,
  pcoConfig: PcoDbConfig,
  communityId: Id<"communities">
): Promise<{ planId: string; serviceTypeId: string } | null> {
  const serviceTypeId = pcoConfig.serviceTypeIds[location];
  if (!serviceTypeId) {
    console.warn(`[PCO Sync] No service type ID for location: ${location}`);
    return null;
  }

  const accessToken = await getValidAccessToken(ctx, communityId);
  const plans = await fetchUpcomingPlans(accessToken, serviceTypeId, 1);

  if (plans.length === 0) {
    console.warn(`[PCO Sync] No upcoming plans for ${location}`);
    return null;
  }

  return { planId: plans[0].id, serviceTypeId };
}

/**
 * Get a valid PCO access token using DB config.
 */
async function getPcoAccessTokenFromConfig(
  ctx: ActionCtx,
  communityId: Id<"communities">
): Promise<string> {
  return await getValidAccessToken(ctx, communityId);
}

/**
 * Find a PCO team ID for a role using DB config role mappings.
 */
async function findTeamForRoleFromConfig(
  accessToken: string,
  serviceTypeId: string,
  role: string,
  pcoConfig: PcoDbConfig
): Promise<{ teamId: string; positionName: string } | null> {
  const mapping = pcoConfig.roleMappings[role];
  if (!mapping) {
    console.warn(`[PCO Sync] No role mapping for: ${role}`);
    return null;
  }

  const teams = await fetchTeamsForServiceType(accessToken, serviceTypeId);
  const pattern = mapping.teamNamePattern.toLowerCase();
  const match = teams.find((t) =>
    t.attributes.name.toLowerCase().includes(pattern)
  );

  if (!match) {
    console.warn(
      `[PCO Sync] No team matching "${pattern}" found. Available: ${teams.map((t) => t.attributes.name).join(", ")}`
    );
    return null;
  }

  return { teamId: match.id, positionName: mapping.positionName };
}

/**
 * Core: Assign a person to a role on the upcoming plan.
 */
export async function assignPersonToRoleCore(
  ctx: ActionCtx,
  location: string,
  role: string,
  personName: string,
  pcoConfig: PcoDbConfig,
  communityId: Id<"communities">
): Promise<{ success: boolean; detail: string }> {
  try {
    const plan = await getUpcomingSundayPlanFromConfig(ctx, location, pcoConfig, communityId);
    if (!plan) return { success: false, detail: "No upcoming plan found" };

    const accessToken = await getPcoAccessTokenFromConfig(ctx, communityId);
    const personId = await findOrCreatePcoPerson(accessToken, personName);
    if (!personId) return { success: false, detail: `Could not find "${personName}" in PCO` };

    const teamInfo = await findTeamForRoleFromConfig(accessToken, plan.serviceTypeId, role, pcoConfig);
    if (!teamInfo) return { success: false, detail: `No team mapping for role "${role}"` };

    try {
      await assignPersonToRole(
        accessToken,
        plan.serviceTypeId,
        plan.planId,
        personId,
        teamInfo.teamId,
        teamInfo.positionName,
        role
      );
    } catch (error: unknown) {
      if (error && typeof error === "object" && "status" in error && (error as { status: number }).status === 422) {
        return { success: true, detail: `${personName} already assigned to ${role}` };
      }
      throw error;
    }

    return { success: true, detail: `Assigned ${personName} as ${role} (confirmed)` };
  } catch (error) {
    return { success: false, detail: String(error) };
  }
}

/**
 * Core: Remove a person from a role on the upcoming plan.
 */
export async function removePersonFromRoleCore(
  ctx: ActionCtx,
  location: string,
  role: string,
  personName: string,
  pcoConfig: PcoDbConfig,
  communityId: Id<"communities">
): Promise<{ success: boolean; detail: string }> {
  try {
    const plan = await getUpcomingSundayPlanFromConfig(ctx, location, pcoConfig, communityId);
    if (!plan) return { success: false, detail: "No upcoming plan found" };

    const accessToken = await getPcoAccessTokenFromConfig(ctx, communityId);
    const mapping = pcoConfig.roleMappings[role];
    if (!mapping) return { success: false, detail: `No role mapping for "${role}"` };

    const result = await removePersonFromRole(
      accessToken,
      plan.serviceTypeId,
      plan.planId,
      personName,
      mapping.positionName,
      mapping.positionName
    );

    return result.success
      ? { success: true, detail: `Removed ${personName} from ${role}` }
      : { success: false, detail: result.reason || "Unknown error" };
  } catch (error) {
    return { success: false, detail: String(error) };
  }
}

/** Config for a V2 plan item — passed from tools.ts when available. */
export interface PlanItemConfig {
  pcoItemTitlePattern: string;
  pcoItemField: string; // "description" | "notes"
  preserveSections?: string[];
}

/**
 * Core: Update a plan item (preach notes, announcements, or any V2-configured item).
 *
 * When `itemConfig` is provided (V2 path), uses its patterns for item matching
 * and field selection. Falls back to hardcoded logic for V1 item types.
 */
export async function updatePlanItemCore(
  ctx: ActionCtx,
  location: string,
  itemType: string,
  content: string,
  pcoConfig: PcoDbConfig,
  communityId: Id<"communities">,
  itemConfig?: PlanItemConfig
): Promise<{ success: boolean; detail: string }> {
  try {
    const plan = await getUpcomingSundayPlanFromConfig(ctx, location, pcoConfig, communityId);
    if (!plan) return { success: false, detail: "No upcoming plan found" };

    const accessToken = await getPcoAccessTokenFromConfig(ctx, communityId);

    // V2 config-driven path
    if (itemConfig) {
      const planItems = await fetchPlanItems(accessToken, plan.serviceTypeId, plan.planId);
      const patterns = itemConfig.pcoItemTitlePattern.split("|").map((p) => p.trim().toLowerCase());
      const matchedItem = planItems.data.find((item) => {
        const title = item.attributes.title.toLowerCase();
        return patterns.some((p) => title.includes(p));
      });

      if (!matchedItem) {
        return { success: false, detail: `No plan item matching "${itemConfig.pcoItemTitlePattern}" found in PCO plan` };
      }

      let finalContent = content;
      const field = itemConfig.pcoItemField === "notes" ? "notes" : "description";

      // Handle preserve sections (e.g., preserve GIVING in announcements)
      if (itemConfig.preserveSections && itemConfig.preserveSections.length > 0) {
        const existing = String((matchedItem.attributes as Record<string, unknown>)[field] || "");
        const preservedParts: string[] = [];
        // Build a pattern that matches from section header to the next section header or end.
        // This prevents greedy capture from swallowing subsequent sections.
        const allSectionHeaders = itemConfig.preserveSections.map((s) => `\\b${s}\\b`).join("|");
        for (const section of itemConfig.preserveSections) {
          const sectionRegex = new RegExp(
            `\\n?(\\b${section}\\b[\\s\\S]*?)(?=\\n(?:${allSectionHeaders})|$)`,
            "i"
          );
          const sectionMatch = existing.match(sectionRegex);
          if (sectionMatch) {
            preservedParts.push(sectionMatch[1].trimEnd());
          }
        }
        if (preservedParts.length > 0) {
          finalContent = `${content}\n\n${preservedParts.join("\n\n")}`;
        }
      }

      await pcoFetch(
        accessToken,
        `${PCO_SERVICES_BASE}/service_types/${plan.serviceTypeId}/plans/${plan.planId}/items/${matchedItem.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            data: { type: "Item", attributes: { [field]: finalContent } },
          }),
        }
      );
      return { success: true, detail: `Updated "${matchedItem.attributes.title}" ${field} in PCO` };
    }

    // V1 hardcoded fallback
    if (itemType === "preach_notes") {
      const planItems = await fetchPlanItems(accessToken, plan.serviceTypeId, plan.planId);
      const messageItem = planItems.data.find((item) => {
        const title = item.attributes.title.toLowerCase();
        return title.includes("message") || title.includes("preach") || title.includes("sermon");
      });

      if (!messageItem) return { success: false, detail: "No Message item found in PCO plan" };

      await pcoFetch(
        accessToken,
        `${PCO_SERVICES_BASE}/service_types/${plan.serviceTypeId}/plans/${plan.planId}/items/${messageItem.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            data: { type: "Item", attributes: { description: content } },
          }),
        }
      );
      return { success: true, detail: "Updated preach notes in PCO" };
    }

    if (itemType === "announcements") {
      const planItems = await fetchPlanItems(accessToken, plan.serviceTypeId, plan.planId);
      const announcementsItem = planItems.data.find((item) => {
        const title = item.attributes.title.toLowerCase();
        return title.includes("announcement");
      });

      if (!announcementsItem) return { success: false, detail: "No Announcements item found in PCO plan" };

      const existing = announcementsItem.attributes.description || "";
      const givingMatch = existing.match(/\n?(\bGIVING\b[\s\S]*)/i);
      const newDescription = givingMatch
        ? `ANNOUNCEMENTS\n${content}\n\n${givingMatch[1]}`
        : `ANNOUNCEMENTS\n${content}`;

      await pcoFetch(
        accessToken,
        `${PCO_SERVICES_BASE}/service_types/${plan.serviceTypeId}/plans/${plan.planId}/items/${announcementsItem.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            data: { type: "Item", attributes: { description: newDescription } },
          }),
        }
      );
      return { success: true, detail: "Updated announcements in PCO (preserved Giving section)" };
    }

    return { success: false, detail: `Unsupported item type: ${itemType}` };
  } catch (error) {
    return { success: false, detail: String(error) };
  }
}

/**
 * Core: Search PCO people by query.
 *
 * Searches both the broad PCO People directory (via searchPeopleByName)
 * AND the current plan's team members. This ensures people not yet
 * assigned to the plan can still be found and resolved.
 */
export async function searchPcoPeopleCore(
  ctx: ActionCtx,
  location: string,
  query: string,
  pcoConfig: PcoDbConfig,
  communityId: Id<"communities">
): Promise<{ results: Array<{ name: string; position: string | null }> }> {
  try {
    const accessToken = await getPcoAccessTokenFromConfig(ctx, communityId);

    // Search the broad PCO People directory first
    const pcoResults = await searchPeopleByName(accessToken, query);
    const broadResults = pcoResults.map((p) => ({
      name: `${p.firstName} ${p.lastName}`.trim(),
      position: null as string | null,
    }));

    // Also search plan team members for position context
    const plan = await getUpcomingSundayPlanFromConfig(ctx, location, pcoConfig, communityId);
    if (plan) {
      const teamMembers = await fetchPlanTeamMembers(accessToken, plan.serviceTypeId, plan.planId);
      const queryLower = query.toLowerCase();
      const planMatches = teamMembers.filter((m) =>
        m.name.toLowerCase().includes(queryLower)
      );

      // Merge: plan members have position info, deduplicate by name
      const seenNames = new Set(planMatches.map((m) => m.name.toLowerCase()));
      const mergedResults = [
        ...planMatches.map((m) => ({ name: m.name, position: m.position })),
        ...broadResults.filter((r) => !seenNames.has(r.name.toLowerCase())),
      ];

      return { results: mergedResults };
    }

    return { results: broadResults };
  } catch (error) {
    console.error("[PCO Sync] Error searching people:", error);
    return { results: [] };
  }
}

/**
 * Extract concatenated item_notes content for a plan item from the included array.
 */
function extractItemNotes(item: PcoPlanItem, included: PcoPlanItemsResponse["included"]): string | null {
  const noteRefs = item.relationships?.item_notes?.data;
  if (!noteRefs || noteRefs.length === 0 || !included) return null;
  const noteIds = new Set(noteRefs.map((r) => r.id));
  const notes = included
    .filter((inc): inc is PcoItemNote => inc.type === "ItemNote" && noteIds.has(inc.id))
    .map((n) => n.attributes.content)
    .filter(Boolean);
  return notes.length > 0 ? notes.join("\n") : null;
}

/**
 * Core: Fetch full PCO context for a location (using DB config).
 */
export async function fetchPcoContextCore(
  ctx: ActionCtx,
  location: string,
  pcoConfig: PcoDbConfig,
  communityId: Id<"communities">
): Promise<PcoContext | null> {
  try {
    const plan = await getUpcomingSundayPlanFromConfig(ctx, location, pcoConfig, communityId);
    if (!plan) return null;

    const accessToken = await getPcoAccessTokenFromConfig(ctx, communityId);

    const [teamMembers, planItems] = await Promise.all([
      fetchPlanTeamMembers(accessToken, plan.serviceTypeId, plan.planId),
      fetchPlanItems(accessToken, plan.serviceTypeId, plan.planId),
    ]);

    const platformRoles: Record<string, string> = {};
    const platformRolesAll: Record<string, { name: string; status: string }> = {};
    for (const m of teamMembers) {
      if (
        m.teamName?.toLowerCase().includes("platform") &&
        m.position
      ) {
        // platformRoles: only confirmed (C) — backward compat
        if (m.status === "C") {
          platformRoles[m.position] = m.name;
        }
        // platformRolesAll: any status with an actual person assigned
        if ((m.status === "C" || m.status === "U") && m.pcoPersonId) {
          platformRolesAll[m.position] = { name: m.name, status: m.status };
        }
      }
    }

    return {
      planId: plan.planId,
      serviceTypeId: plan.serviceTypeId,
      planDate: new Date().toISOString().split("T")[0],
      teamMembers: teamMembers.map((m) => ({
        name: m.name,
        status: m.status,
        position: m.position,
        teamName: m.teamName,
        pcoPersonId: m.pcoPersonId,
      })),
      platformRoles,
      platformRolesAll,
      items: planItems.data.map((item) => ({
        title: item.attributes.title,
        itemType: item.attributes.item_type,
        description: item.attributes.description || null,
        notes: extractItemNotes(item, planItems.included),
        length: item.attributes.length || null,
      })),
    };
  } catch (error) {
    console.error("[PCO Sync] Error fetching PCO context:", error);
    return null;
  }
}

// ============================================================================
// Sync Helpers
// ============================================================================

/**
 * Assign a person to a role on a PCO plan.
 * Fills an existing empty ("Needed") slot if one exists for the position,
 * otherwise creates a new team member entry.
 * Status is "C" (confirmed) — matches PCO's "confirm on manually adding" setting.
 */
async function assignPersonToRole(
  accessToken: string,
  serviceTypeId: string,
  planId: string,
  personId: string,
  teamId: string,
  positionName: string,
  label: string
): Promise<{ success: boolean; filled?: boolean }> {
  // Fetch current team members to check for empty "Needed" slots
  const teamMembers = await fetchPlanTeamMembers(
    accessToken,
    serviceTypeId,
    planId,
    [teamId]
  );

  // Look for an empty slot: same position, no person assigned (placeholder)
  const emptySlot = teamMembers.find(
    (m) =>
      m.position?.toLowerCase() === positionName.toLowerCase() &&
      !m.pcoPersonId
  );

  if (emptySlot) {
    // Fill the existing empty slot via PATCH
    await pcoFetch(
      accessToken,
      `${PCO_SERVICES_BASE}/service_types/${serviceTypeId}/plans/${planId}/team_members/${emptySlot.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          data: {
            type: "PlanPerson",
            attributes: {
              status: "C", // Confirmed — matches PCO's "confirm on manually adding"
            },
            relationships: {
              person: { data: { type: "Person", id: personId } },
            },
          },
        }),
      }
    );
    console.log(`[PCO Sync] Filled empty ${label} slot (ID: ${emptySlot.id}) with person ${personId}`);
    return { success: true, filled: true };
  }

  // No empty slot — create a new team member entry
  await pcoFetch(
    accessToken,
    `${PCO_SERVICES_BASE}/service_types/${serviceTypeId}/plans/${planId}/team_members`,
    {
      method: "POST",
      body: JSON.stringify({
        data: {
          type: "PlanPerson",
          attributes: {
            status: "C", // Confirmed — matches PCO's "confirm on manually adding"
            team_position_name: positionName,
          },
          relationships: {
            person: { data: { type: "Person", id: personId } },
            team: { data: { type: "Team", id: teamId } },
          },
        },
      }),
    }
  );
  console.log(`[PCO Sync] Created new ${label} entry for person ${personId}`);
  return { success: true, filled: false };
}

/**
 * Remove a person from a role on a PCO plan.
 * Finds the team member by position name and person name, then DELETEs them.
 */
async function removePersonFromRole(
  accessToken: string,
  serviceTypeId: string,
  planId: string,
  personName: string,
  positionName: string,
  label: string
): Promise<{ success: boolean; reason?: string }> {
  const teamMembers = await fetchPlanTeamMembers(
    accessToken,
    serviceTypeId,
    planId
  );

  // Find the team member matching this position and name
  const member = teamMembers.find(
    (m) =>
      m.position?.toLowerCase() === positionName.toLowerCase() &&
      m.name.toLowerCase().includes(personName.toLowerCase()) &&
      m.pcoPersonId // Must have an actual person assigned
  );

  if (!member) {
    console.warn(`[PCO Sync] No ${label} named "${personName}" found in plan`);
    return { success: false, reason: `No ${label} named "${personName}" found in the plan` };
  }

  await pcoFetch(
    accessToken,
    `${PCO_SERVICES_BASE}/service_types/${serviceTypeId}/plans/${planId}/team_members/${member.id}`,
    { method: "DELETE" }
  );

  console.log(`[PCO Sync] Removed ${label} "${personName}" (ID: ${member.id}) from plan`);
  return { success: true };
}

// ============================================================================
// Sync Actions
// ============================================================================

/**
 * Sync preacher assignment to PCO plan.
 * Fills an existing "Needed" slot if available, otherwise creates a new entry.
 * Status is "C" (confirmed) — matches PCO's "confirm on manually adding" setting.
 */
export const syncPreacherToPCO = internalAction({
  args: {
    location: v.string(),
    preacherName: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const plan = await getUpcomingSundayPlan(ctx, args.location);
      if (!plan) return { success: false, reason: "No upcoming plan found" };

      const accessToken = await getPcoAccessToken(ctx);

      const personId = await findOrCreatePcoPerson(accessToken, args.preacherName);
      if (!personId) {
        return { success: false, reason: `Could not find or create person "${args.preacherName}" in PCO` };
      }

      const teamId = await findTeamForRole(accessToken, plan.serviceTypeId, "preacher");
      if (!teamId) {
        return { success: false, reason: "No Speaker team found in PCO for this service type" };
      }

      const positionName = PCO_ROLE_MAPPINGS.preacher.positionName;

      try {
        await assignPersonToRole(
          accessToken,
          plan.serviceTypeId,
          plan.planId,
          personId,
          teamId,
          positionName,
          "Preacher"
        );
      } catch (error: unknown) {
        // Handle "already assigned" gracefully (PCO returns 422)
        if (error && typeof error === "object" && "status" in error && (error as { status: number }).status === 422) {
          console.log(`[PCO Sync] Preacher "${args.preacherName}" already assigned to plan`);
          return { success: true, planId: plan.planId, alreadyAssigned: true };
        }
        throw error;
      }

      console.log(
        `[PCO Sync] Synced preacher "${args.preacherName}" to ${args.location} plan ${plan.planId}`
      );
      return { success: true, planId: plan.planId };
    } catch (error) {
      console.error("[PCO Sync] Error syncing preacher:", error);
      return { success: false, reason: String(error) };
    }
  },
});

/**
 * Sync music leader assignment to PCO plan.
 * Fills an existing "Needed" slot if available, otherwise creates a new entry.
 * Status is "C" (confirmed) — matches PCO's "confirm on manually adding" setting.
 */
export const syncMeetingLeaderToPCO = internalAction({
  args: {
    location: v.string(),
    meetingLeaderName: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const plan = await getUpcomingSundayPlan(ctx, args.location);
      if (!plan) return { success: false, reason: "No upcoming plan found" };

      const accessToken = await getPcoAccessToken(ctx);

      const personId = await findOrCreatePcoPerson(accessToken, args.meetingLeaderName);
      if (!personId) {
        return { success: false, reason: `Could not find or create person "${args.meetingLeaderName}" in PCO` };
      }

      const teamId = await findTeamForRole(accessToken, plan.serviceTypeId, "meetingLead");
      if (!teamId) {
        return { success: false, reason: "No Meeting Lead team found in PCO for this service type" };
      }

      const positionName = PCO_ROLE_MAPPINGS.meetingLead.positionName;

      try {
        await assignPersonToRole(
          accessToken,
          plan.serviceTypeId,
          plan.planId,
          personId,
          teamId,
          positionName,
          "Meeting Leader"
        );
      } catch (error: unknown) {
        if (error && typeof error === "object" && "status" in error && (error as { status: number }).status === 422) {
          console.log(`[PCO Sync] ML "${args.meetingLeaderName}" already assigned to plan`);
          return { success: true, planId: plan.planId, alreadyAssigned: true };
        }
        throw error;
      }

      console.log(
        `[PCO Sync] Synced ML "${args.meetingLeaderName}" to ${args.location} plan ${plan.planId}`
      );
      return { success: true, planId: plan.planId };
    } catch (error) {
      console.error("[PCO Sync] Error syncing music leader:", error);
      return { success: false, reason: String(error) };
    }
  },
});

/**
 * Remove a person from a role on the PCO plan.
 * Used when someone says "remove X from preaching" etc.
 */
export const removeFromPcoPlan = internalAction({
  args: {
    location: v.string(),
    role: v.string(), // "preacher" or "meetingLead"
    personName: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const plan = await getUpcomingSundayPlan(ctx, args.location);
      if (!plan) return { success: false, reason: "No upcoming plan found" };

      const accessToken = await getPcoAccessToken(ctx);
      const mapping = PCO_ROLE_MAPPINGS[args.role];
      if (!mapping) {
        return { success: false, reason: `No role mapping for "${args.role}"` };
      }

      return await removePersonFromRole(
        accessToken,
        plan.serviceTypeId,
        plan.planId,
        args.personName,
        mapping.positionName,
        mapping.positionName
      );
    } catch (error) {
      console.error(`[PCO Sync] Error removing ${args.role}:`, error);
      return { success: false, reason: String(error) };
    }
  },
});

/**
 * Sync preach notes/points to the Message item in the PCO plan.
 * Finds the existing "Message" item and PATCHes its description.
 */
export const syncPreachNotesToPCO = internalAction({
  args: {
    location: v.string(),
    preachNotes: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const plan = await getUpcomingSundayPlan(ctx, args.location);
      if (!plan) return { success: false, reason: "No upcoming plan found" };

      const accessToken = await getPcoAccessToken(ctx);

      // Fetch plan items to find the "Message" item
      const planItems = await fetchPlanItems(
        accessToken,
        plan.serviceTypeId,
        plan.planId
      );

      // Look for an item with "message" or "preach" in the title (case-insensitive)
      const messageItem = planItems.data.find((item) => {
        const title = item.attributes.title.toLowerCase();
        return title.includes("message") || title.includes("preach") || title.includes("sermon");
      });

      if (!messageItem) {
        console.warn(`[PCO Sync] No "Message" item found in ${args.location} plan ${plan.planId}`);
        return { success: false, reason: "No Message item found in PCO plan" };
      }

      // PATCH the description on the Message item
      await pcoFetch(
        accessToken,
        `${PCO_SERVICES_BASE}/service_types/${plan.serviceTypeId}/plans/${plan.planId}/items/${messageItem.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            data: {
              type: "Item",
              attributes: {
                description: args.preachNotes,
              },
            },
          }),
        }
      );

      console.log(
        `[PCO Sync] Updated preach notes on "${messageItem.attributes.title}" in ${args.location} plan ${plan.planId}`
      );
      return { success: true, planId: plan.planId, itemId: messageItem.id };
    } catch (error) {
      console.error("[PCO Sync] Error syncing preach notes:", error);
      return { success: false, reason: String(error) };
    }
  },
});

/**
 * Sync setlist (songs) to PCO plan as plan items.
 */
export const syncSetlistToPCO = internalAction({
  args: {
    location: v.string(),
    songs: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      const plan = await getUpcomingSundayPlan(ctx, args.location);
      if (!plan) return { success: false, reason: "No upcoming plan found" };

      const accessToken = await getPcoAccessToken(ctx);

      // Add each song as a plan item
      for (const songTitle of args.songs) {
        await pcoFetch(
          accessToken,
          `${PCO_SERVICES_BASE}/service_types/${plan.serviceTypeId}/plans/${plan.planId}/items`,
          {
            method: "POST",
            body: JSON.stringify({
              data: {
                type: "Item",
                attributes: {
                  title: songTitle,
                  item_type: "song",
                },
              },
            }),
          }
        );
      }

      console.log(
        `[PCO Sync] Added ${args.songs.length} songs to ${args.location} plan ${plan.planId}`
      );
      return { success: true, planId: plan.planId, songsAdded: args.songs.length };
    } catch (error) {
      console.error("[PCO Sync] Error syncing setlist:", error);
      return { success: false, reason: String(error) };
    }
  },
});

/**
 * Sync announcements to the Announcements item in the PCO plan.
 * Finds the existing "Announcements" item and PATCHes its description.
 */
export const syncAnnouncementsToPCO = internalAction({
  args: {
    location: v.string(),
    announcements: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const plan = await getUpcomingSundayPlan(ctx, args.location);
      if (!plan) return { success: false, reason: "No upcoming plan found" };

      const accessToken = await getPcoAccessToken(ctx);

      // Find the Announcements item in the order of service
      const planItems = await fetchPlanItems(accessToken, plan.serviceTypeId, plan.planId);
      const announcementsItem = planItems.data.find((item) => {
        const title = item.attributes.title.toLowerCase();
        return title.includes("announcement");
      });

      if (!announcementsItem) {
        return { success: false, reason: "No Announcements item found in PCO plan" };
      }

      // Only replace the ANNOUNCEMENTS section, preserving GIVING and anything after it
      const existing = announcementsItem.attributes.description || "";
      const givingMatch = existing.match(/\n?(\bGIVING\b[\s\S]*)/i);
      const newDescription = givingMatch
        ? `ANNOUNCEMENTS\n${args.announcements}\n\n${givingMatch[1]}`
        : `ANNOUNCEMENTS\n${args.announcements}`;

      await pcoFetch(
        accessToken,
        `${PCO_SERVICES_BASE}/service_types/${plan.serviceTypeId}/plans/${plan.planId}/items/${announcementsItem.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            data: { type: "Item", attributes: { description: newDescription } },
          }),
        }
      );

      console.log(
        `[PCO Sync] Updated announcements on "${announcementsItem.attributes.title}" in ${args.location} plan ${plan.planId}`
      );
      return { success: true, planId: plan.planId };
    } catch (error) {
      console.error("[PCO Sync] Error syncing announcements:", error);
      return { success: false, reason: String(error) };
    }
  },
});

// ============================================================================
// PCO Context Fetcher (for answering questions)
// ============================================================================

export interface PcoContext {
  planId: string;
  serviceTypeId: string;
  planDate: string;
  teamMembers: Array<{
    name: string;
    status: string;
    position: string | null;
    teamName: string | null;
    pcoPersonId: string | null;
  }>;
  /** Confirmed PLATFORM team positions pulled dynamically from PCO (position → name) */
  platformRoles: Record<string, string>;
  /** ALL assigned PLATFORM team positions (C or U status, excludes "Needed" placeholders) */
  platformRolesAll: Record<string, { name: string; status: string }>;
  items: Array<{
    title: string;
    itemType: string;
    description: string | null;
    notes: string | null;
    length: number | null;
  }>;
}

/**
 * Fetch full PCO plan context for a location's upcoming Sunday.
 * Returns team members, items, and plan metadata — everything the bot
 * needs to answer questions about the plan.
 */
export const fetchPcoContext = internalAction({
  args: {
    location: v.string(),
  },
  handler: async (ctx, args): Promise<PcoContext | null> => {
    try {
      const plan = await getUpcomingSundayPlan(ctx, args.location);
      if (!plan) return null;

      const accessToken = await getPcoAccessToken(ctx);

      // Fetch team members and items in parallel
      const [teamMembers, planItems] = await Promise.all([
        fetchPlanTeamMembers(accessToken, plan.serviceTypeId, plan.planId),
        fetchPlanItems(accessToken, plan.serviceTypeId, plan.planId),
      ]);

      // Extract PLATFORM team roles dynamically
      const platformRoles: Record<string, string> = {};
      const platformRolesAll: Record<string, { name: string; status: string }> = {};
      for (const m of teamMembers) {
        if (
          m.teamName?.toLowerCase().includes("platform") &&
          m.position
        ) {
          if (m.status === "C") {
            platformRoles[m.position] = m.name;
          }
          if ((m.status === "C" || m.status === "U") && m.pcoPersonId) {
            platformRolesAll[m.position] = { name: m.name, status: m.status };
          }
        }
      }

      return {
        planId: plan.planId,
        serviceTypeId: plan.serviceTypeId,
        planDate: new Date().toISOString().split("T")[0],
        teamMembers: teamMembers.map((m) => ({
          name: m.name,
          status: m.status,
          position: m.position,
          teamName: m.teamName,
          pcoPersonId: m.pcoPersonId,
        })),
        platformRoles,
        platformRolesAll,
        items: planItems.data.map((item) => ({
          title: item.attributes.title,
          itemType: item.attributes.item_type,
          description: item.attributes.description || null,
          notes: extractItemNotes(item, planItems.included),
          length: item.attributes.length || null,
        })),
      };
    } catch (error) {
      console.error("[PCO Sync] Error fetching PCO context:", error);
      return null;
    }
  },
});
