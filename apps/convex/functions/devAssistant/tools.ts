/**
 * Dev-Assistant Bot — Agent Tools
 *
 * OpenAI function-calling tool definitions + dispatcher. Each tool maps to a
 * Convex DB op (via ctx.runMutation/runQuery) or posts a bot message into the
 * originating chat thread.
 */

import { ActionCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";

// ============================================================================
// Types
// ============================================================================

export interface ToolExecutionContext {
  communityId: Id<"communities">;
  channelId: Id<"chatChannels">;
  threadRootMessageId?: Id<"chatMessages">;
  originatorUserId: Id<"users">;
  /** Screenshot URLs collected from the thread, stored on create_bug. */
  screenshotUrls: string[];
  /** Set by create_bug; lets later tool calls reference the same bug. */
  currentBugId?: Id<"devBugs">;
}

// ============================================================================
// Tool definitions
// ============================================================================

export function buildToolDefinitions() {
  return [
    {
      type: "function" as const,
      function: {
        name: "create_bug",
        description:
          "Open a new bug from the thread discussion. Synthesizes a clean, self-contained implementation brief. Call this once per thread; use update_bug to refine afterwards.",
        parameters: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "One short imperative line summarizing the bug/feature.",
            },
            body: {
              type: "string",
              description:
                "The full implementation brief — problem, expected behavior, concrete details. Self-contained (do not reference 'the thread').",
            },
            repro: {
              type: "string",
              description: "Optional exact steps to reproduce, for bugs.",
            },
          },
          required: ["title", "body"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "update_bug",
        description:
          "Revise the brief of the bug already open in this thread as the humans refine it.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Updated title." },
            body: { type: "string", description: "Updated implementation brief." },
            repro: { type: "string", description: "Updated repro steps." },
          },
          required: [],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "set_bug_status",
        description:
          "Mark the bug ready for implementation when a human says it's ready. You may ONLY set READY_FOR_IMPL.",
        parameters: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["READY_FOR_IMPL"],
              description: "The only status the agent may set.",
            },
          },
          required: ["status"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "get_bug",
        description: "Read the current state of the bug open in this thread.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "reply_in_thread",
        description:
          "Post a message back into the chat thread. Use this for all human-facing responses — confirmations, questions, the review link.",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", description: "Plain-text message to post." },
          },
          required: ["text"],
          additionalProperties: false,
        },
      },
    },
  ];
}

// ============================================================================
// Dispatcher
// ============================================================================

export async function executeTool(
  ctx: ActionCtx,
  toolName: string,
  args: Record<string, unknown>,
  execCtx: ToolExecutionContext,
): Promise<Record<string, unknown>> {
  switch (toolName) {
    case "create_bug": {
      if (execCtx.currentBugId) {
        return {
          success: false,
          error: "A bug already exists for this thread; use update_bug.",
          bugId: execCtx.currentBugId,
        };
      }
      const { bugId, reviewLink, reviewUrl } = await ctx.runMutation(
        internal.functions.devAssistant.bugs.createBug,
        {
          communityId: execCtx.communityId,
          channelId: execCtx.channelId,
          threadRootMessageId: execCtx.threadRootMessageId,
          originatorUserId: execCtx.originatorUserId,
          title: args.title as string,
          body: args.body as string,
          repro: args.repro as string | undefined,
          screenshotUrls:
            execCtx.screenshotUrls.length > 0 ? execCtx.screenshotUrls : undefined,
        },
      );
      execCtx.currentBugId = bugId;

      // Post the bug card into the thread. The card content is a generic
      // placeholder, NOT the synthesized title: insertBotMessage copies content
      // into lastMessagePreview and onMessageSent uses it for push previews to
      // all channel members, so the staff-only title must not live here. The
      // card itself renders the real title via the staff-gated getBugForReview
      // query.
      await ctx.runMutation(internal.functions.scheduledJobs.insertBotMessage, {
        channelId: execCtx.channelId,
        content: "📝 Opened a bug for review",
        botType: "dev_assistant",
        contentType: "bug_card",
        bugId,
        parentMessageId: execCtx.threadRootMessageId,
        sourceKey: `bug:${bugId}:card`,
      });

      return { success: true, bugId, reviewLink, reviewUrl };
    }

    case "update_bug": {
      const bugId = (args.bugId as Id<"devBugs"> | undefined) ?? execCtx.currentBugId;
      if (!bugId) return { success: false, error: "No bug open in this thread." };
      const result = await ctx.runMutation(
        internal.functions.devAssistant.bugs.updateBug,
        {
          bugId,
          title: args.title as string | undefined,
          body: args.body as string | undefined,
          repro: args.repro as string | undefined,
          // Refresh the screenshot set so screenshots added to the thread after
          // the bug was created (and which prompted this refinement) reach the
          // routine payload. getThreadContext collects the full current set.
          screenshotUrls:
            execCtx.screenshotUrls.length > 0
              ? execCtx.screenshotUrls
              : undefined,
        },
      );
      return { success: result.ok, ...result };
    }

    case "set_bug_status": {
      const bugId = (args.bugId as Id<"devBugs"> | undefined) ?? execCtx.currentBugId;
      if (!bugId) return { success: false, error: "No bug open in this thread." };
      const result = await ctx.runMutation(
        internal.functions.devAssistant.bugs.setBugStatus,
        { bugId, status: args.status as "READY_FOR_IMPL" },
      );
      return { success: result.ok, ...result };
    }

    case "get_bug": {
      const bugId = (args.bugId as Id<"devBugs"> | undefined) ?? execCtx.currentBugId;
      if (!bugId) return { success: false, error: "No bug open in this thread." };
      const bug = await ctx.runQuery(
        internal.functions.devAssistant.bugs.getBug,
        { bugId },
      );
      return { success: true, bug };
    }

    case "reply_in_thread": {
      try {
        await ctx.runMutation(internal.functions.scheduledJobs.insertBotMessage, {
          channelId: execCtx.channelId,
          content: args.text as string,
          botType: "dev_assistant",
          contentType: "bot",
          bugId: execCtx.currentBugId,
          parentMessageId: execCtx.threadRootMessageId,
        });
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}
