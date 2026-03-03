/**
 * FOUNT Service Planning Bot - Prompt Builders
 *
 * Constructs system prompts incorporating DB config overrides.
 * Three entry points:
 * 1. @mention (respond + act)
 * 2. catchup sync (pre-nag PCO sync pass)
 * 3. nag cron (pre-computed status report)
 */

import { Doc } from "../../_generated/dataModel";
import type { PcoContext } from "./pcoSync";
import { getServicePlanItems, type ServicePlanItemV2 } from "./configHelpers";

type SlackBotConfig = Doc<"slackBotConfig">;

// ============================================================================
// Item Status Pre-Computation
// ============================================================================

export interface ItemStatus {
  itemId: string;
  label: string;
  status: "confirmed" | "missing" | "unknown";
  detail: string;
  responsibleSlackIds: string[];
}

/**
 * Pre-compute the confirmed/missing status for each service plan item
 * using PCO data. This removes AI judgment from status determination.
 *
 * - assign_role items: check platformRolesAll for assigned person (any status)
 * - update_plan_item items: check PCO plan items for non-empty content
 * - none items: can't determine from PCO, defaults to "unknown"
 */
export function computeItemStatuses(
  config: SlackBotConfig,
  pcoContext: PcoContext | null,
  location?: string
): ItemStatus[] {
  const items = getServicePlanItems(config);

  return items.map((item) => {
    const responsible = config.teamMembers.filter(
      (m) =>
        m.roles.some((r) => item.responsibleRoles.includes(r)) &&
        (!location || m.locations.includes(location))
    );
    const responsibleSlackIds = responsible.map((m) => m.slackUserId);

    if (!pcoContext) {
      return {
        itemId: item.id,
        label: item.label,
        status: "unknown" as const,
        detail: "PCO data unavailable",
        responsibleSlackIds,
      };
    }

    if (item.actionType === "assign_role") {
      return computeRoleStatus(item, pcoContext, responsibleSlackIds);
    }

    if (item.actionType === "update_plan_item") {
      return computePlanItemStatus(item, pcoContext, responsibleSlackIds);
    }

    // actionType === "none" — can't determine from PCO
    return {
      itemId: item.id,
      label: item.label,
      status: "unknown" as const,
      detail: "Cannot be determined from PCO — check thread messages",
      responsibleSlackIds,
    };
  });
}

function computeRoleStatus(
  item: ServicePlanItemV2,
  pcoContext: PcoContext,
  responsibleSlackIds: string[]
): ItemStatus {
  const positionName = item.pcoPositionName || item.label;

  // Check platformRolesAll (includes both C and U status, excludes "Needed" placeholders)
  const assigned = pcoContext.platformRolesAll[positionName];
  if (assigned) {
    const statusLabel = assigned.status === "C" ? "confirmed" : "unconfirmed";
    return {
      itemId: item.id,
      label: item.label,
      status: "confirmed",
      detail: `${assigned.name} (${statusLabel} in PCO)`,
      responsibleSlackIds,
    };
  }

  // Fallback: check teamMembers directly for any matching position with a real person
  // Only include C (confirmed) or U (unconfirmed) — exclude D (declined)
  const teamPattern = (item.pcoTeamNamePattern || "platform").toLowerCase();
  const assignedMember = pcoContext.teamMembers.find(
    (m) =>
      m.teamName?.toLowerCase().includes(teamPattern) &&
      m.position?.toLowerCase() === positionName.toLowerCase() &&
      m.pcoPersonId && // Has an actual person, not a "Needed" placeholder
      (m.status === "C" || m.status === "U") // Not declined
  );

  if (assignedMember) {
    const statusLabel = assignedMember.status === "C" ? "confirmed" : "unconfirmed";
    return {
      itemId: item.id,
      label: item.label,
      status: "confirmed",
      detail: `${assignedMember.name} (${statusLabel} in PCO)`,
      responsibleSlackIds,
    };
  }

  return {
    itemId: item.id,
    label: item.label,
    status: "missing",
    detail: "No one assigned in PCO",
    responsibleSlackIds,
  };
}

function computePlanItemStatus(
  item: ServicePlanItemV2,
  pcoContext: PcoContext,
  responsibleSlackIds: string[]
): ItemStatus {
  const patterns = (item.pcoItemTitlePattern || "")
    .split("|")
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);

  if (patterns.length === 0) {
    return {
      itemId: item.id,
      label: item.label,
      status: "unknown" as const,
      detail: "No PCO item title pattern configured",
      responsibleSlackIds,
    };
  }

  const matchedItem = pcoContext.items.find((i) =>
    patterns.some((p) => i.title.toLowerCase().includes(p))
  );

  if (!matchedItem) {
    return {
      itemId: item.id,
      label: item.label,
      status: "missing",
      detail: "No matching item found in PCO plan",
      responsibleSlackIds,
    };
  }

  // Check the configured field for content
  const field = item.pcoItemField || "description";
  const content = field === "notes" ? matchedItem.notes : matchedItem.description;

  if (content && content.trim().length > 0) {
    const preview = content.trim().substring(0, 80);
    return {
      itemId: item.id,
      label: item.label,
      status: "confirmed",
      detail: `Has content in PCO: "${preview}${content.trim().length > 80 ? "..." : ""}"`,
      responsibleSlackIds,
    };
  }

  return {
    itemId: item.id,
    label: item.label,
    status: "missing",
    detail: `"${matchedItem.title}" exists in PCO but has no content`,
    responsibleSlackIds,
  };
}

// ============================================================================
// Mention Prompt (triggered by @mention in a thread)
// ============================================================================

/**
 * Build the system prompt for an @mention agent invocation.
 * Incorporates bot personality, response rules, team context, and PCO state.
 */
export function buildMentionPrompt(
  config: SlackBotConfig,
  pcoContext: PcoContext | null
): string {
  const ai = config.aiConfig;
  const pcoSection = pcoContext
    ? formatPcoContext(pcoContext)
    : "(PCO data unavailable — answer based on thread context only)";

  const teamMembersSection = config.teamMembers
    .map((m) => `- ${m.name} (Slack: <@${m.slackUserId}>, roles: ${m.roles.join(", ")}, locations: ${m.locations.join(", ")})`)
    .join("\n");

  // Build per-item AI instructions section
  const items = getServicePlanItems(config);
  const itemInstructions = items
    .filter((i) => i.aiInstructions)
    .map((i) => `- **${i.label}**: ${i.aiInstructions}`)
    .join("\n");
  const perItemSection = itemInstructions
    ? `\n## Per-Item Instructions\n${itemInstructions}\n`
    : "";

  // Build dynamic capabilities description from configured items
  const roleItems = items.filter((i) => i.actionType === "assign_role");
  const planItems = items.filter((i) => i.actionType === "update_plan_item");
  const rolesList = roleItems.length > 0
    ? roleItems.map((i) => i.label).join(", ")
    : "Preacher, Meeting Lead";
  const planItemsList = planItems.length > 0
    ? planItems.map((i) => i.label).join(", ")
    : "preach notes, announcements";

  return `${ai.botPersonality}

## Your Capabilities
You have tools to:
- Assign or remove people from roles in Planning Center (PCO): ${rolesList}
- Update plan items in PCO: ${planItemsList}
- Search PCO for people by name (use this to resolve nicknames/short names to full names)
- Reply in the Slack thread
- Add emoji reactions to messages

## Response Rules
${ai.responseRules}

## Team Context
${ai.teamContext}

## Team Members
${teamMembersSection}

## Current PCO Plan State
${pcoSection}
${perItemSection}
## Instructions
1. Read the conversation carefully. The last message is the one that triggered you.
2. Determine what action to take based on the message and thread context.
3. If new service planning info was shared (preacher, ML, notes, etc.):
   - Add a ✅ reaction (white_check_mark)
   - Sync the info to PCO using the appropriate tools
   - Do NOT reply with a confirmation message — the ✅ reaction is sufficient
4. If someone asks a question about the plan:
   - Reply with the answer using PCO data and thread context
5. If someone asks you to generate content (preach points, service flow, etc.):
   - Add an ⏳ reaction (hourglass_flowing_sand)
   - Generate the content and reply with it
6. If someone asks to sync to PCO:
   - Add a ⚙️ reaction (gear)
   - Perform the sync operations and reply with results
7. If the message is just a bare @mention with no text, review the thread and provide a helpful summary
8. For irrelevant messages (banter, thanks, etc.), do NOT reply — just return without using any tools
9. When assigning people to PCO roles, use search_pco_people first to resolve short names to full names
10. When you DO reply, use the reply_in_thread tool — never return text directly
11. Never prefix your replies with user IDs or brackets like "[U123]:" — just write the message content directly`;
}

// ============================================================================
// Catchup Sync Prompt (Phase 1 of two-phase nag)
// ============================================================================

/**
 * Build the system prompt for a pre-nag catchup sync.
 * The agent reviews thread history and syncs any info to PCO that
 * a previous bot run may have failed to sync.
 */
export function buildCatchupSyncPrompt(
  config: SlackBotConfig,
  pcoContext: PcoContext | null,
  location?: string
): string {
  const pcoSection = pcoContext
    ? formatPcoContext(pcoContext)
    : "(PCO data unavailable)";

  const items = getServicePlanItems(config);
  const itemsList = items
    .map((item) => `- ${item.label} (action: ${item.actionType})`)
    .join("\n");

  // Build per-item AI instructions
  const itemInstructions = items
    .filter((i) => i.aiInstructions)
    .map((i) => `- **${i.label}**: ${i.aiInstructions}`)
    .join("\n");
  const perItemSection = itemInstructions
    ? `\n## Per-Item Instructions\n${itemInstructions}\n`
    : "";

  return `You are performing a pre-nag sync check for the ${location || "unknown"} location.

## Your Task
Review the Slack thread history and compare against the current PCO plan state below.
If you find service planning information shared in the thread that is NOT yet reflected in PCO, sync it now using the available tools.

## Important Rules
- ONLY sync information that was explicitly shared in the thread (e.g., "Mike is preaching", "preach notes: ...", "announcements: ...")
- Do NOT make assumptions or infer information that wasn't clearly stated
- Do NOT post any messages — this is a silent sync pass
- Use search_pco_people to resolve names before assigning roles
- If unsure whether something was shared, DO NOT sync it — err on the side of caution

## Items to Track
${itemsList}
${perItemSection}
## Current PCO Plan State
${pcoSection}`;
}

// ============================================================================
// Nag Prompt (triggered by cron for status checks)
// ============================================================================

/**
 * Build the system prompt for a nag/status check agent invocation.
 * Uses pre-computed item statuses from PCO data to prevent AI hallucination.
 * The agent's job is to FORMAT the status message, not DECIDE what's confirmed.
 */
export function buildNagPrompt(
  config: SlackBotConfig,
  nagLevel: { urgency: string; label: string },
  pcoContext: PcoContext | null,
  location?: string,
  preComputedStatuses?: ItemStatus[]
): string {
  const ai = config.aiConfig;
  const tone = ai.nagToneByLevel[nagLevel.urgency] || "Be helpful and clear.";

  const statuses = preComputedStatuses || computeItemStatuses(config, pcoContext, location);

  const confirmedItems = statuses.filter((s) => s.status === "confirmed");
  const missingItems = statuses.filter((s) => s.status === "missing");
  const unknownItems = statuses.filter((s) => s.status === "unknown");

  // Build the authoritative status section
  const statusLines: string[] = [
    "## Pre-Computed Item Status (from PCO data)",
    "These statuses were computed directly from Planning Center data.",
    "For ✅ and ❌ items, these are AUTHORITATIVE — do NOT override them.",
    "For ⚠️ items, check the thread history to determine their status.",
    "",
  ];

  for (const s of confirmedItems) {
    statusLines.push(`✅ ${s.label}: ${s.detail}`);
  }
  for (const s of missingItems) {
    statusLines.push(`❌ ${s.label}: ${s.detail}`);
  }
  for (const s of unknownItems) {
    statusLines.push(`⚠️ ${s.label}: ${s.detail}`);
  }

  const statusSection = statusLines.join("\n");

  // Build responsible section for @mentions on missing items
  const shouldMention = nagLevel.urgency !== "gentle";
  let mentionSection = "";
  if (shouldMention) {
    const mentionLines = missingItems
      .filter((s) => s.responsibleSlackIds.length > 0)
      .map((s) => `- ${s.label}: ${s.responsibleSlackIds.map((id) => `<@${id}>`).join(" ")}`);
    // Also add unknown items that might be missing after thread check
    const unknownMentionLines = unknownItems
      .filter((s) => s.responsibleSlackIds.length > 0)
      .map((s) => `- ${s.label} (if missing): ${s.responsibleSlackIds.map((id) => `<@${id}>`).join(" ")}`);
    const allMentions = [...mentionLines, ...unknownMentionLines];
    if (allMentions.length > 0) {
      mentionSection = `\n## Responsible People (for missing items)\n${allMentions.join("\n")}`;
    }
  }

  return `${ai.botPersonality}

## Your Task
You are performing a scheduled ${nagLevel.label} (${nagLevel.urgency} urgency).

## Tone
${tone}

## Response Rules
${ai.responseRules}

${statusSection}
${mentionSection}

## Instructions
1. Use the pre-computed statuses above as the DEFINITIVE source of truth for ✅ and ❌ items
2. For items marked ✅, include them as confirmed in your status update with their details
3. For items marked ❌, include them as missing in your status update
4. For items marked ⚠️, check the thread history — if the item was shared/discussed, mark as ✅; otherwise mark as ❌
5. Compose a status update message:
   - List confirmed items with ✅
   - List missing items with ❌
   ${nagLevel.urgency === "gentle" ? "- Don't @mention individuals for this gentle nag" : "- @mention the responsible people for missing items"}
6. Post the status update using reply_in_thread
7. If everything is confirmed, post a brief celebratory "all set" message instead
8. Never prefix your replies with user IDs or brackets like "[U123]:" — just write the message content directly`;
}

// ============================================================================
// Helpers
// ============================================================================

function formatPcoContext(pcoContext: PcoContext): string {
  // Platform roles (confirmed only)
  const platformEntries = Object.entries(pcoContext.platformRoles);
  const platformRolesText =
    platformEntries.length > 0
      ? platformEntries.map(([pos, name]) => `  ${pos}: ${name}`).join("\n")
      : "  (No confirmed platform team members yet)";

  // Platform roles (all assigned, including unconfirmed)
  const allEntries = Object.entries(pcoContext.platformRolesAll);
  const platformRolesAllText =
    allEntries.length > 0
      ? allEntries.map(([pos, info]) => `  ${pos}: ${info.name} (${info.status === "C" ? "confirmed" : "unconfirmed"})`).join("\n")
      : "  (No platform team members assigned yet)";

  // Team members by team
  const teamsByName = new Map<string, string[]>();
  for (const member of pcoContext.teamMembers) {
    const team = member.teamName || "Unassigned";
    const entry = `${member.name} (${member.position || "member"}, ${member.status})`;
    const list = teamsByName.get(team) || [];
    list.push(entry);
    teamsByName.set(team, list);
  }
  const teamMembersText = Array.from(teamsByName.entries())
    .map(([team, members]) => `  ${team}:\n${members.map((m) => `    - ${m}`).join("\n")}`)
    .join("\n");

  // Plan items
  const itemsText = pcoContext.items
    .map((item) => {
      const desc = item.description ? ` — ${item.description}` : "";
      return `  - ${item.title} [${item.itemType}]${desc}`;
    })
    .join("\n");

  return `=== PLATFORM Roles (Confirmed) ===
${platformRolesText}

=== PLATFORM Roles (All Assigned) ===
${platformRolesAllText}

=== All Team Members by Team ===
${teamMembersText || "  (No team members assigned yet)"}

=== Service Items (Run Sheet) ===
${itemsText || "  (No items in the plan yet)"}`;
}
