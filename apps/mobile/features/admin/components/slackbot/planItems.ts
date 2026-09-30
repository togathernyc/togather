import type { PcoRoleMapping, ServicePlanItemV2 } from "../../hooks/useSlackBotConfig";

/** The slice of slackBotConfig needed to read service plan items. */
interface PlanItemsConfig {
  servicePlanItemsV2?: ServicePlanItemV2[] | null;
  servicePlanItems: string[];
  servicePlanLabels: Record<string, string>;
  itemResponsibleRoles: Record<string, string[]>;
  pcoConfig: { roleMappings: Record<string, PcoRoleMapping> };
}

// V1 → V2 defaults for items with known plan-item sync behavior
const PLAN_ITEM_DEFAULTS: Record<
  string,
  { pcoItemTitlePattern: string; pcoItemField: string; preserveSections?: string[] }
> = {
  preachNotes: { pcoItemTitlePattern: "message|preach|sermon", pcoItemField: "description" },
  announcements: {
    pcoItemTitlePattern: "announcement",
    pcoItemField: "description",
    preserveSections: ["GIVING"],
  },
};

/** Items in V2 format — V2 if present, otherwise reconstructed from the V1 fields. */
export function getV2Items(config: PlanItemsConfig | null | undefined): ServicePlanItemV2[] {
  if (!config) return [];
  if (config.servicePlanItemsV2 && config.servicePlanItemsV2.length > 0) {
    return config.servicePlanItemsV2;
  }

  return config.servicePlanItems.map((id): ServicePlanItemV2 => {
    const base = {
      id,
      label: config.servicePlanLabels[id] || id,
      responsibleRoles: config.itemResponsibleRoles[id] || [],
    };
    const roleMapping = config.pcoConfig.roleMappings[id];
    if (roleMapping) {
      return {
        ...base,
        actionType: "assign_role",
        pcoTeamNamePattern: roleMapping.teamNamePattern,
        pcoPositionName: roleMapping.positionName,
      };
    }
    const planItemDefaults = PLAN_ITEM_DEFAULTS[id];
    if (planItemDefaults) {
      return { ...base, actionType: "update_plan_item", ...planItemDefaults };
    }
    return { ...base, actionType: "none" };
  });
}
