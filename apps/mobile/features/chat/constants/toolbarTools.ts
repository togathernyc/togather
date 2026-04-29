/**
 * Toolbar Tool Definitions
 *
 * Shared constants for leader toolbar tools.
 * Used by ChatNavigation.tsx and toolbar-settings.tsx
 */

export interface ToolDefinition {
  id: string;
  icon: string;
  label: string;
  requiresPco?: boolean;
  defaultVisibility?: "leaders" | "everyone"; // Controls who can see this tool
}

/**
 * All available toolbar tools with their metadata.
 * Uses `satisfies` to preserve literal types while ensuring type safety.
 */
export const TOOLBAR_TOOLS = {
  attendance: { id: "attendance", icon: "checkmark", label: "Attendance" },
  followup: {
    id: "followup",
    icon: "chatbubble-ellipses-outline",
    label: "People",
  },
  tasks: {
    id: "tasks",
    icon: "checkmark-done-outline",
    label: "Tasks",
  },
  // NOTE: "events" and "bots" were retired from the toolbar — they live
  // as sections on the group page (UpcomingEventsSection,
  // GroupBotsSection). Existing groups whose `leaderToolbarTools` still
  // references these IDs are filtered out at the consumer (ChatNavigation
  // skips IDs not in this record).
  sync: {
    id: "sync",
    icon: "sync-outline",
    label: "Sync",
    requiresPco: true,
  },
  runsheet: {
    id: "runsheet",
    icon: "list-outline",
    label: "Run Sheet",
    requiresPco: true,
    defaultVisibility: "everyone",
  },
} as const satisfies Record<string, ToolDefinition>;

/**
 * Type for valid tool IDs.
 */
export type ToolId = keyof typeof TOOLBAR_TOOLS;

/**
 * Ordered list of all tool IDs.
 */
export const ALL_TOOL_IDS = Object.keys(TOOLBAR_TOOLS) as ToolId[];

/**
 * Default tools shown when leaderToolbarTools is undefined.
 * Notes:
 * - "tasks" is NOT included by default - group leaders must explicitly enable it.
 * - "sync" is NOT included by default - must be explicitly enabled.
 */
export const DEFAULT_TOOLS = ["attendance", "followup"];

/**
 * Resource tool ID helpers.
 * Resource tools use a "resource:" prefix to distinguish them from built-in tools.
 */
export const isResourceToolId = (toolId: string): boolean =>
  toolId.startsWith("resource:");

export const getResourceIdFromToolId = (toolId: string): string =>
  toolId.replace("resource:", "");

export const createResourceToolId = (resourceId: string): string =>
  `resource:${resourceId}`;
