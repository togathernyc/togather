import type { ThemeColors } from "@/theme/colors";

export const AVAILABLE_ROLES = ["preacher", "ml", "worship", "creative", "production", "admin", "av"];

// MIRRORS `BOT_LOCATIONS` in `apps/convex/functions/slackServiceBot/configHelpers.ts`
// — mobile doesn't import convex source, so keep the two in sync by hand.
export const AVAILABLE_LOCATIONS = ["Manhattan", "Brooklyn"];

export const URGENCY_LEVELS = ["gentle", "direct", "urgent", "critical"] as const;

/** Badge/chip color for a reminder urgency level. */
export function urgencyColor(urgency: string, colors: ThemeColors): string {
  if (urgency === "critical") return colors.error;
  if (urgency === "urgent") return colors.warning;
  if (urgency === "direct") return colors.link;
  return colors.success;
}

export const PLAN_ITEM_ACTIONS = [
  { key: "assign_role", label: "Assign Role", badge: "Role" },
  { key: "update_plan_item", label: "Update Item", badge: "Item" },
  { key: "none", label: "Track Only", badge: "Track" },
] as const;

/** Badge/chip color for a service plan item's action type. */
export function planItemActionColor(actionType: string, colors: ThemeColors): string {
  if (actionType === "assign_role") return colors.link;
  if (actionType === "update_plan_item") return colors.success;
  return colors.textTertiary;
}

/** True when the bot runs for `location` — absent from the map means enabled, matching getEnabledLocations on the backend. */
export function isLocationOn(
  locationsEnabled: Record<string, boolean> | undefined,
  location: string,
): boolean {
  return locationsEnabled?.[location] ?? true;
}
