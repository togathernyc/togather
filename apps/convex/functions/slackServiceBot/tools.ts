/**
 * FOUNT Service Planning Bot - Agent Tools
 *
 * OpenAI function-calling tool definitions and dispatcher.
 * Each tool maps to a concrete action the agent can take.
 *
 * Tool definitions are built dynamically from V2 config when available,
 * falling back to hardcoded defaults for V1 configs.
 */

import { ActionCtx } from "../../_generated/server";
import { Doc } from "../../_generated/dataModel";
import {
  assignPersonToRoleCore,
  removePersonFromRoleCore,
  updatePlanItemCore,
  searchPcoPeopleCore,
  type PlanItemConfig,
} from "./pcoSync";
import { postMessage, addReaction } from "./slack";
import { getServicePlanItems } from "./configHelpers";

// ============================================================================
// Types
// ============================================================================

type SlackBotConfig = Doc<"slackBotConfig">;

export interface ToolExecutionContext {
  config: SlackBotConfig;
  slackToken: string;
  channelId: string;
  threadTs: string;
  messageTs: string;
  location: string;
}

// ============================================================================
// Dynamic Tool Definitions
// ============================================================================

/** Default role enum for V1 configs */
const DEFAULT_ROLE_ENUM = ["preacher", "meetingLead"];
/** Default plan item enum for V1 configs */
const DEFAULT_ITEM_TYPE_ENUM = ["preach_notes", "announcements"];

/**
 * Build OpenAI tool definitions dynamically from config.
 *
 * - `assign_to_pco` role enum → built from items with actionType "assign_role"
 * - `remove_from_pco` role enum → same
 * - `update_plan_item` item_type enum → built from items with actionType "update_plan_item"
 *
 * Falls back to hardcoded defaults if no V2 items are configured.
 */
export function buildToolDefinitions(config: SlackBotConfig) {
  const items = getServicePlanItems(config);
  const hasV2Items = items.length > 0;

  const roleItems = items.filter((i) => i.actionType === "assign_role");
  const planItemItems = items.filter((i) => i.actionType === "update_plan_item");

  // Only fall back to defaults when NO V2 items exist at all (legacy config).
  // If V2 items exist but none match a particular actionType, the admin
  // intentionally omitted those — don't offer the tools.
  const roleEnum = roleItems.length > 0
    ? roleItems.map((i) => i.id)
    : hasV2Items ? [] : DEFAULT_ROLE_ENUM;

  const itemTypeEnum = planItemItems.length > 0
    ? planItemItems.map((i) => i.id)
    : hasV2Items ? [] : DEFAULT_ITEM_TYPE_ENUM;

  // Build role descriptions for better AI understanding
  const roleDescriptions = roleItems.length > 0
    ? roleItems.map((i) => `${i.id} (${i.label})`).join(", ")
    : "preacher, meetingLead";

  const itemTypeDescriptions = planItemItems.length > 0
    ? planItemItems.map((i) => `${i.id} (${i.label})`).join(", ")
    : "preach_notes, announcements";

  const tools: Array<{ type: "function"; function: Record<string, unknown> }> = [];

  // Only include assign/remove tools if there are role items
  if (roleEnum.length > 0) {
    tools.push(
      {
        type: "function" as const,
        function: {
          name: "assign_to_pco",
          description:
            `Assign a person to a role on the upcoming Sunday's Planning Center plan. Available roles: ${roleDescriptions}.`,
          parameters: {
            type: "object",
            properties: {
              role: {
                type: "string",
                enum: roleEnum,
                description: "The role to assign",
              },
              person_name: {
                type: "string",
                description:
                  "Full name of the person to assign. Resolve short names/nicknames to full names using search_pco_people first if unsure.",
              },
            },
            required: ["role", "person_name"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function" as const,
        function: {
          name: "remove_from_pco",
          description:
            `Remove a person from a role on the upcoming Sunday's Planning Center plan. Available roles: ${roleDescriptions}.`,
          parameters: {
            type: "object",
            properties: {
              role: {
                type: "string",
                enum: roleEnum,
                description: "The role to remove the person from",
              },
              person_name: {
                type: "string",
                description: "Full name of the person to remove",
              },
            },
            required: ["role", "person_name"],
            additionalProperties: false,
          },
        },
      },
    );
  }

  // Only include update_plan_item tool if there are plan items
  if (itemTypeEnum.length > 0) {
    tools.push({
      type: "function" as const,
      function: {
        name: "update_plan_item",
        description:
          `Update a plan item in Planning Center. Available items: ${itemTypeDescriptions}.`,
        parameters: {
          type: "object",
          properties: {
            item_type: {
              type: "string",
              enum: itemTypeEnum,
              description: "The type of plan item to update",
            },
            content: {
              type: "string",
              description: "The content to set on the plan item",
            },
          },
          required: ["item_type", "content"],
          additionalProperties: false,
        },
      },
    });
  }

  // Always include search, reply, and reaction tools
  tools.push(
    {
      type: "function" as const,
      function: {
        name: "search_pco_people",
        description:
          "Search Planning Center for people by name. Use to resolve short names or nicknames to full names before assigning roles.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Name or partial name to search for",
            },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "reply_in_thread",
        description:
          "Post a message in the Slack thread. Use this for all responses — confirmations, answers, generated content, etc.",
        parameters: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description:
                "The message text to post. Use Slack markdown: *bold*, _italic_, bullet points with •",
            },
          },
          required: ["text"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "add_reaction",
        description:
          "Add an emoji reaction to the triggering message. Use white_check_mark for confirmations, gear for syncing, hourglass_flowing_sand for processing.",
        parameters: {
          type: "object",
          properties: {
            emoji: {
              type: "string",
              description:
                "The emoji name without colons (e.g. 'white_check_mark', 'gear', 'hourglass_flowing_sand')",
            },
          },
          required: ["emoji"],
          additionalProperties: false,
        },
      },
    },
  );

  return tools;
}

// ============================================================================
// Tool Dispatcher
// ============================================================================

/**
 * Execute a tool call from the agent loop.
 * Returns a result object that gets sent back to OpenAI as tool output.
 */
export async function executeTool(
  ctx: ActionCtx,
  toolName: string,
  args: Record<string, unknown>,
  execCtx: ToolExecutionContext
): Promise<Record<string, unknown>> {
  switch (toolName) {
    case "assign_to_pco": {
      const result = await assignPersonToRoleCore(
        ctx,
        execCtx.location,
        args.role as string,
        args.person_name as string,
        execCtx.config.pcoConfig,
        execCtx.config.communityId
      );
      return result;
    }

    case "remove_from_pco": {
      const result = await removePersonFromRoleCore(
        ctx,
        execCtx.location,
        args.role as string,
        args.person_name as string,
        execCtx.config.pcoConfig,
        execCtx.config.communityId
      );
      return result;
    }

    case "update_plan_item": {
      // Look up V2 item config for this item_type
      const items = getServicePlanItems(execCtx.config);
      const itemConfig = items.find(
        (i) => i.id === args.item_type && i.actionType === "update_plan_item"
      );

      const planItemConfig: PlanItemConfig | undefined = itemConfig?.pcoItemTitlePattern
        ? {
            pcoItemTitlePattern: itemConfig.pcoItemTitlePattern,
            pcoItemField: itemConfig.pcoItemField || "description",
            preserveSections: itemConfig.preserveSections,
          }
        : undefined;

      const result = await updatePlanItemCore(
        ctx,
        execCtx.location,
        args.item_type as string,
        args.content as string,
        execCtx.config.pcoConfig,
        execCtx.config.communityId,
        planItemConfig
      );
      return result;
    }

    case "search_pco_people": {
      const result = await searchPcoPeopleCore(
        ctx,
        execCtx.location,
        args.query as string,
        execCtx.config.pcoConfig,
        execCtx.config.communityId
      );
      return result;
    }

    case "reply_in_thread": {
      try {
        await postMessage(
          execCtx.slackToken,
          execCtx.channelId,
          args.text as string,
          execCtx.threadTs
        );
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }

    case "add_reaction": {
      try {
        await addReaction(
          execCtx.slackToken,
          execCtx.channelId,
          execCtx.messageTs,
          args.emoji as string
        );
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}
