/**
 * FOUNT Service Planning Bot - AI Helpers
 *
 * Deterministic message builders and pure utility functions for:
 * - Thread creation and intro messages
 * - Missing items detection
 * - Nag/status messages
 * - Confirmation messages
 * - Generated content wrappers
 * - PCO sync result messages
 *
 * The intent classification, content generation, and Q&A functions have been
 * replaced by the stateless agent loop (see agent.ts).
 */

import { type ServicePlanItem, type NagSchedule, type TeamMember } from "./config";
import { formatMention } from "./slack";

// ============================================================================
// Types
// ============================================================================

/** Parsed state of a service plan from thread messages */
export interface ServicePlanState {
  preacher: string | null;
  meetingLead: string | null;
  preachNotes: string | null;
  setlist: string | null;
  serviceFlow: string | null;
  announcements: string | null;
  serviceVideo: string | null;
}

export type BotIntent = "info_update" | "question" | "generate" | "pco_action" | "irrelevant";

export type GenerateType = "preach_points" | "service_flow" | "announcements";

export type PcoActionType = "sync_all" | "sync_preacher" | "sync_ml" | "sync_setlist" | "sync_announcements" | "sync_preach_notes";

export interface IntentResult {
  state: ServicePlanState;
  intent: BotIntent;
  /** AI-generated answer for "question" intent */
  reply?: string;
  /** Details for "generate" intent */
  generateRequest?: {
    type: GenerateType;
    context: string;
  };
  /** Details for "pco_action" intent */
  pcoAction?: {
    action: PcoActionType;
  };
  /** Explicit removals requested (e.g. "remove Kev from preaching") */
  removals?: Array<{
    role: string;
    personName: string;
  }>;
}

// ============================================================================
// Thread Creation Messages (deterministic, not AI-generated)
// ============================================================================

/**
 * Build the initial thread message for a location.
 *
 * Matches Samantha's real format from #services:
 *   "M.DD.YY MH SUNDAY SERVICE PLANNING"
 *   @user1 @user2 @user3 ...
 *
 * threadMentions comes from DB config (per-location Slack user IDs).
 */
export function buildThreadCreationMessage(
  location: "Manhattan" | "Brooklyn",
  sundayDate: string,
  threadMentions: Record<string, string[]>,
): string {
  const locationCode = location === "Manhattan" ? "MH" : "BK";
  const mentionIds = threadMentions[location] ?? [];
  const mentions = mentionIds.map((id) => formatMention(id)).join("  ");

  return `${sundayDate} ${locationCode} SUNDAY SERVICE PLANNING${mentions ? `\n${mentions}` : ""}`;
}

/**
 * Build the introductory reply posted inside the thread after creation.
 * Guides the team on what to share.
 */
export function buildThreadIntroMessage(
  location: "Manhattan" | "Brooklyn",
  botSlackUserId: string,
): string {
  return (
    `Here's what needs to be confirmed: Preacher, Meeting Lead, Preach Notes, Setlist, Service Flow, Announcements, Service Video.\n\n` +
    `Reply in this thread naturally. If you want anything updated in PCO or have any questions, just <@${botSlackUserId}> and I'll help out.`
  );
}

// ============================================================================
// Missing Items Detection
// ============================================================================

/** Config shape needed by ai.ts helpers */
interface BotConfig {
  servicePlanItems: string[];
  servicePlanLabels: Record<string, string>;
  itemResponsibleRoles: Record<string, string[]>;
  teamMembers: TeamMember[];
}

/**
 * Determine which service plan items are still missing.
 */
export function getMissingItems(state: ServicePlanState, config: BotConfig): ServicePlanItem[] {
  return (config.servicePlanItems as ServicePlanItem[]).filter((item) => {
    const value = state[item];
    if (value === null || value === undefined) return true;
    if (Array.isArray(value) && value.length === 0) return true;
    if (typeof value === "string" && value.trim() === "") return true;
    return false;
  });
}

/**
 * Get team members responsible for a missing item at a specific location.
 */
export function getResponsibleMembers(
  item: ServicePlanItem,
  location: "Manhattan" | "Brooklyn",
  config: BotConfig,
): TeamMember[] {
  const roles = config.itemResponsibleRoles[item] ?? [];
  return config.teamMembers.filter(
    (m) =>
      m.roles.some((r) => roles.includes(r)) && m.locations.includes(location)
  );
}

// ============================================================================
// Nag Message Templates (Deterministic, not AI)
// ============================================================================

/**
 * Determine if a nag should fire right now.
 * Returns the nag schedule entry if due, null otherwise.
 */
export function getNagDueNow(nowET: Date, nagSchedule: NagSchedule[]): NagSchedule | null {
  const dayOfWeek = nowET.getDay();
  const hour = nowET.getHours();

  return (
    nagSchedule.find(
      (nag) => nag.dayOfWeek === dayOfWeek && nag.hourET === hour
    ) || null
  );
}

/**
 * Build a nag message based on urgency and missing items.
 */
export function buildNagMessage(
  nag: NagSchedule,
  location: "Manhattan" | "Brooklyn",
  state: ServicePlanState,
  missingItems: ServicePlanItem[],
  config: BotConfig,
): string {
  if (missingItems.length === 0) {
    return `${getUrgencyEmoji(nag.urgency)} *${location} Service Update*\n\n:white_check_mark: All items confirmed! We're all set for Sunday.`;
  }

  const header = getNagHeader(nag.urgency, location, missingItems.length);
  const confirmedSection = buildConfirmedSection(state, config);
  const missingSection = buildMissingSection(missingItems, location, nag.urgency, config);

  return `${header}\n\n${confirmedSection}\n\n${missingSection}`;
}

function getUrgencyEmoji(urgency: NagSchedule["urgency"]): string {
  switch (urgency) {
    case "gentle":
      return ":clipboard:";
    case "direct":
      return ":eyes:";
    case "urgent":
      return ":warning:";
    case "critical":
      return ":rotating_light:";
  }
}

function getNagHeader(
  urgency: NagSchedule["urgency"],
  location: string,
  missingCount: number
): string {
  switch (urgency) {
    case "gentle":
      return `${getUrgencyEmoji(urgency)} *${location} Service — Mid-week Status*\nHere's where we are. ${missingCount} item${missingCount === 1 ? "" : "s"} still needed:`;
    case "direct":
      return `${getUrgencyEmoji(urgency)} *${location} Service — Thursday Check-in*\nWe still need ${missingCount} item${missingCount === 1 ? "" : "s"}. Please update when you can:`;
    case "urgent":
      return `${getUrgencyEmoji(urgency)} *${location} Service — 2 Days Out!*\n${missingCount} item${missingCount === 1 ? "" : "s"} still missing. Please confirm ASAP:`;
    case "critical":
      return `${getUrgencyEmoji(urgency)} *${location} Service — FINAL CALL*\nService is *tomorrow*. ${missingCount} item${missingCount === 1 ? "" : "s"} still unconfirmed:`;
  }
}

function buildConfirmedSection(state: ServicePlanState, _config: BotConfig): string {
  const confirmed: string[] = [];

  if (state.preacher) confirmed.push(`:white_check_mark: Preacher: ${state.preacher}`);
  if (state.meetingLead) confirmed.push(`:white_check_mark: ML: ${state.meetingLead}`);
  if (state.preachNotes) confirmed.push(`:white_check_mark: Preach Notes: ${state.preachNotes}`);
  if (state.setlist) confirmed.push(`:white_check_mark: Setlist: confirmed`);
  if (state.serviceFlow) confirmed.push(`:white_check_mark: Service Flow: confirmed`);
  if (state.announcements) confirmed.push(`:white_check_mark: Announcements: confirmed`);
  if (state.serviceVideo) confirmed.push(`:white_check_mark: Service Video: ${state.serviceVideo}`);

  if (confirmed.length === 0) return "_No items confirmed yet._";
  return `*Confirmed:*\n${confirmed.join("\n")}`;
}

function buildMissingSection(
  missingItems: ServicePlanItem[],
  location: "Manhattan" | "Brooklyn",
  urgency: NagSchedule["urgency"],
  config: BotConfig,
): string {
  const lines = missingItems.map((item) => {
    const label = config.servicePlanLabels[item] ?? item;
    const responsible = getResponsibleMembers(item, location, config);

    if (urgency === "gentle") {
      // No @mentions for gentle nag
      return `:x: ${label}`;
    }

    // @mention responsible people for direct/urgent/critical
    const mentions = responsible.map((m) => formatMention(m.slackUserId)).join(" ");
    return `:x: ${label} — ${mentions || "team"}`;
  });

  return `*Still needed:*\n${lines.join("\n")}`;
}

// ============================================================================
// Confirmation & Response Messages
// ============================================================================

/**
 * Build confirmation message after parsing a reply with new info.
 */
export function buildConfirmationMessage(
  state: ServicePlanState,
  removals?: Array<{ role: string; personName: string }>
): string {
  const confirmed: string[] = [];

  if (state.preacher) confirmed.push(`Preacher: *${state.preacher}*`);
  if (state.meetingLead) confirmed.push(`ML: *${state.meetingLead}*`);
  if (state.preachNotes) confirmed.push(`Preach Notes: *${state.preachNotes}*`);
  if (state.setlist) confirmed.push(`Setlist: confirmed`);
  if (state.serviceFlow) confirmed.push(`Service Flow: confirmed`);
  if (state.announcements) confirmed.push(`Announcements: confirmed`);
  if (state.serviceVideo) confirmed.push(`Service Video: *${state.serviceVideo}*`);

  // Add removal confirmations
  if (removals && removals.length > 0) {
    const roleLabels: Record<string, string> = { preacher: "Preacher", meetingLead: "ML" };
    for (const removal of removals) {
      const label = roleLabels[removal.role] || removal.role;
      confirmed.push(`~${label}: ${removal.personName}~ (removed)`);
    }
  }

  if (confirmed.length === 0) {
    return `:white_check_mark: Got it! No changes to update.`;
  }

  return `:white_check_mark: Got it! Updated:\n${confirmed.map((c) => `• ${c}`).join("\n")}`;
}

/**
 * Build message wrapping generated content for Slack.
 */
export function buildGeneratedContentMessage(
  type: GenerateType,
  content: string
): string {
  const typeLabels: Record<GenerateType, string> = {
    preach_points: "Message Points",
    service_flow: "Service Flow",
    announcements: "Announcements",
  };
  const label = typeLabels[type];
  return `:sparkles: *Generated ${label}:*\n\n${content}`;
}

/**
 * Build confirmation message for PCO sync results.
 */
export function buildPcoSyncConfirmation(
  results: Array<{ item: string; success: boolean; detail: string }>
): string {
  const lines = results.map((r) => {
    const icon = r.success ? ":white_check_mark:" : ":x:";
    return `${icon} ${r.item}: ${r.detail}`;
  });
  return `:gear: *PCO Sync Results:*\n${lines.join("\n")}`;
}
