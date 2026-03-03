/**
 * FOUNT Service Planning Bot - Config Helpers
 *
 * Provides a unified view of service plan items regardless of whether
 * the config uses V2 format or legacy V1 fields. This is the single
 * source of truth for "what items does this bot track and how?"
 */

import { Doc } from "../../_generated/dataModel";

type SlackBotConfig = Doc<"slackBotConfig">;

/** Unified V2 item shape used throughout the codebase. */
export interface ServicePlanItemV2 {
  id: string;
  label: string;
  responsibleRoles: string[];
  actionType: "assign_role" | "update_plan_item" | "none";
  pcoTeamNamePattern?: string;
  pcoPositionName?: string;
  pcoItemTitlePattern?: string;
  pcoItemField?: string; // "description" | "notes"
  preserveSections?: string[];
  aiInstructions?: string;
}

/**
 * Default V2 items — matches the hardcoded V1 behavior.
 * Used when reconstructing from V1 fields that lack V2 detail.
 */
const DEFAULT_ITEM_CONFIGS: Record<string, Partial<ServicePlanItemV2>> = {
  preacher: {
    actionType: "assign_role",
    pcoTeamNamePattern: "platform",
    pcoPositionName: "Preacher",
  },
  meetingLead: {
    actionType: "assign_role",
    pcoTeamNamePattern: "platform",
    pcoPositionName: "Meeting Leader",
  },
  preachNotes: {
    actionType: "update_plan_item",
    pcoItemTitlePattern: "message|preach|sermon",
    pcoItemField: "description",
  },
  announcements: {
    actionType: "update_plan_item",
    pcoItemTitlePattern: "announcement",
    pcoItemField: "description",
    preserveSections: ["GIVING"],
  },
};

/**
 * Get the canonical service plan items for a config.
 *
 * Reads `servicePlanItemsV2` if present, otherwise reconstructs from
 * V1 fields (`servicePlanItems`, `servicePlanLabels`, `itemResponsibleRoles`)
 * combined with `pcoConfig.roleMappings` and hardcoded defaults.
 */
export function getServicePlanItems(config: SlackBotConfig): ServicePlanItemV2[] {
  // If V2 exists, use it directly
  if (config.servicePlanItemsV2 && config.servicePlanItemsV2.length > 0) {
    return config.servicePlanItemsV2 as ServicePlanItemV2[];
  }

  // Guard: if V1 fields are missing (e.g. empty config), return empty
  if (!config.servicePlanItems || config.servicePlanItems.length === 0) {
    return [];
  }

  // Reconstruct from V1 fields
  return config.servicePlanItems.map((id) => {
    const label = config.servicePlanLabels[id] || id;
    const responsibleRoles = config.itemResponsibleRoles[id] || [];
    const defaults = DEFAULT_ITEM_CONFIGS[id];

    // Check if this item has a role mapping in pcoConfig
    const roleMapping = config.pcoConfig.roleMappings[id];

    if (roleMapping) {
      return {
        id,
        label,
        responsibleRoles,
        actionType: "assign_role" as const,
        pcoTeamNamePattern: roleMapping.teamNamePattern,
        pcoPositionName: roleMapping.positionName,
      };
    }

    if (defaults) {
      return {
        id,
        label,
        responsibleRoles,
        ...defaults,
        actionType: defaults.actionType as ServicePlanItemV2["actionType"],
      };
    }

    // No config — track only
    return {
      id,
      label,
      responsibleRoles,
      actionType: "none" as const,
    };
  });
}

/**
 * Sync V2 items back to V1 fields for backward compatibility.
 * Returns the V1 fields that should be patched alongside V2.
 */
export function v2ToV1Fields(items: ServicePlanItemV2[]) {
  const servicePlanItems = items.map((i) => i.id);
  const servicePlanLabels: Record<string, string> = {};
  const itemResponsibleRoles: Record<string, string[]> = {};
  const roleMappings: Record<string, { teamNamePattern: string; positionName: string }> = {};

  for (const item of items) {
    servicePlanLabels[item.id] = item.label;
    itemResponsibleRoles[item.id] = item.responsibleRoles;

    if (item.actionType === "assign_role" && item.pcoTeamNamePattern && item.pcoPositionName) {
      roleMappings[item.id] = {
        teamNamePattern: item.pcoTeamNamePattern,
        positionName: item.pcoPositionName,
      };
    }
  }

  return { servicePlanItems, servicePlanLabels, itemResponsibleRoles, roleMappings };
}

/**
 * Strip a V2 item to only the fields expected by the mutation validator.
 * This prevents Convex's strict v.object() validator from rejecting items
 * that may have extra fields from DB storage or schema evolution.
 */
export function sanitizeV2Item(item: ServicePlanItemV2): ServicePlanItemV2 {
  const sanitized: ServicePlanItemV2 = {
    id: item.id,
    label: item.label,
    responsibleRoles: item.responsibleRoles,
    actionType: item.actionType,
  };
  if (item.pcoTeamNamePattern !== undefined) sanitized.pcoTeamNamePattern = item.pcoTeamNamePattern;
  if (item.pcoPositionName !== undefined) sanitized.pcoPositionName = item.pcoPositionName;
  if (item.pcoItemTitlePattern !== undefined) sanitized.pcoItemTitlePattern = item.pcoItemTitlePattern;
  if (item.pcoItemField !== undefined) sanitized.pcoItemField = item.pcoItemField;
  if (item.preserveSections !== undefined) sanitized.preserveSections = item.preserveSections;
  if (item.aiInstructions !== undefined) sanitized.aiInstructions = item.aiInstructions;
  return sanitized;
}
