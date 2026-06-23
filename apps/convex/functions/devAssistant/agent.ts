/**
 * Dev-Assistant Bot — Stateless Agent Loop
 *
 * Cloned from slackServiceBot/agent.ts. Same OpenAI chat-completions wire
 * format and tool-use loop; the tool set is Convex-DB ops instead of Slack
 * tools, and the user turn may include image_url content blocks so the agent
 * can read thread screenshots (gpt-4o vision).
 */

import { ActionCtx } from "../../_generated/server";
import { buildToolDefinitions, executeTool, type ToolExecutionContext } from "./tools";

// ============================================================================
// Types
// ============================================================================

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentBlock[] | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface OpenAIToolCallResponse {
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
}

interface AgentResult {
  response: string | null;
  toolsUsed: string[];
  iterations: number;
}

// ============================================================================
// Agent loop
// ============================================================================

export async function runAgentLoop(
  ctx: ActionCtx,
  opts: {
    systemPrompt: string;
    /** Pre-built conversation turns (user/assistant), content may carry images. */
    threadMessages: AgentMessage[];
    executionContext: ToolExecutionContext;
    model?: string;
    maxIterations?: number;
  },
): Promise<AgentResult> {
  const {
    systemPrompt,
    threadMessages,
    executionContext,
    model = "gpt-4o",
    maxIterations = 5,
  } = opts;

  const openaiKey = process.env.OPENAI_SECRET_KEY;
  if (!openaiKey) {
    throw new Error("OPENAI_SECRET_KEY not configured");
  }

  const toolDefinitions = buildToolDefinitions();

  const messages: AgentMessage[] = [
    { role: "system", content: systemPrompt },
    ...threadMessages,
  ];

  const toolsUsed: string[] = [];

  for (let i = 0; i < maxIterations; i++) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        tools: toolDefinitions,
        tool_choice: "auto",
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorBody}`);
    }

    const data: OpenAIToolCallResponse = await response.json();
    const choice = data.choices[0];

    if (!choice) {
      console.error("[DevAssistant] No choice in OpenAI response");
      return { response: null, toolsUsed, iterations: i + 1 };
    }

    if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
      messages.push({
        role: "assistant",
        content: choice.message.content,
        tool_calls: choice.message.tool_calls,
      });

      for (const call of choice.message.tool_calls) {
        const toolName = call.function.name;

        let args: Record<string, unknown>;
        try {
          args = JSON.parse(call.function.arguments);
        } catch {
          args = {};
          console.error(
            `[DevAssistant] Failed to parse args for ${toolName}:`,
            call.function.arguments,
          );
        }

        console.log(`[DevAssistant] Executing tool: ${toolName}`, args);
        const result = await executeTool(ctx, toolName, args, executionContext);

        const resultObj = result as Record<string, unknown> | null;
        if (!resultObj || resultObj.success !== false) {
          toolsUsed.push(toolName);
        }

        messages.push({
          role: "tool",
          content: JSON.stringify(result),
          tool_call_id: call.id,
        });
      }

      continue;
    }

    // No tool calls — model is done.
    return { response: choice.message.content, toolsUsed, iterations: i + 1 };
  }

  console.warn(`[DevAssistant] Hit max iterations (${maxIterations})`);
  return { response: null, toolsUsed, iterations: maxIterations };
}

// ============================================================================
// Message building
// ============================================================================

/**
 * Turn the thread window into a single OpenAI user turn. Text is rendered as a
 * transcript; image attachments become image_url blocks so the model can read
 * screenshots.
 */
export function buildThreadMessages(
  messages: Array<{ senderName: string; content: string; imageUrls: string[] }>,
): AgentMessage[] {
  const transcript = messages
    .map((m) => `${m.senderName}: ${m.content}`)
    .join("\n");

  const content: ContentBlock[] = [
    {
      type: "text",
      text: `Here is the chat thread:\n\n${transcript}`,
    },
  ];

  for (const m of messages) {
    for (const url of m.imageUrls) {
      content.push({ type: "image_url", image_url: { url } });
    }
  }

  return [{ role: "user", content }];
}
