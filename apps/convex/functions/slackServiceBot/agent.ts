/**
 * FOUNT Service Planning Bot - Stateless Agent Loop
 *
 * Core OpenAI tool-use loop. Sends messages + tool definitions, executes tool
 * calls inline, loops until the model returns a text response. Max 5 iterations.
 */

import { ActionCtx } from "../../_generated/server";
import { buildToolDefinitions, executeTool, type ToolExecutionContext } from "./tools";

// ============================================================================
// Types
// ============================================================================

interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
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
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface ToolCallDetail {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  durationMs: number;
}

interface AgentResult {
  response: string | null;
  toolsUsed: string[];
  toolCallDetails: ToolCallDetail[];
  iterations: number;
}

// ============================================================================
// Agent Loop
// ============================================================================

/**
 * Run the stateless agent loop.
 *
 * Sends the conversation to OpenAI with tool definitions, executes any tool
 * calls the model makes, and loops until the model responds with text (no more
 * tool calls) or we hit maxIterations.
 */
export async function runAgentLoop(
  ctx: ActionCtx,
  opts: {
    systemPrompt: string;
    threadMessages: Array<{ role: "user" | "assistant"; content: string }>;
    executionContext: ToolExecutionContext;
    maxIterations?: number;
    /** Only include tools whose function name is in this list. Omit for all tools. */
    allowedTools?: string[];
  }
): Promise<AgentResult> {
  const { systemPrompt, threadMessages, executionContext, maxIterations = 5, allowedTools } = opts;
  const model = executionContext.config.aiConfig.model || "gpt-4o-mini";
  let toolDefinitions = buildToolDefinitions(executionContext.config);
  if (allowedTools) {
    toolDefinitions = toolDefinitions.filter(
      (t) => allowedTools.includes(t.function.name as string)
    );
  }

  const openaiKey = process.env.OPENAI_SECRET_KEY;
  if (!openaiKey) {
    throw new Error("OPENAI_SECRET_KEY not configured");
  }

  const messages: AgentMessage[] = [
    { role: "system", content: systemPrompt },
    ...threadMessages,
  ];

  const toolsUsed: string[] = [];
  const toolCallDetails: ToolCallDetail[] = [];

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
      console.error("[Agent] No choice in OpenAI response");
      return { response: null, toolsUsed, toolCallDetails, iterations: i + 1 };
    }

    // If the model made tool calls, execute them and continue the loop
    if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
      // Add assistant message with tool calls to conversation
      messages.push({
        role: "assistant",
        content: choice.message.content,
        tool_calls: choice.message.tool_calls,
      });

      // Execute each tool call
      for (const call of choice.message.tool_calls) {
        const toolName = call.function.name;

        let args: Record<string, unknown>;
        try {
          args = JSON.parse(call.function.arguments);
        } catch {
          args = {};
          console.error(`[Agent] Failed to parse args for ${toolName}:`, call.function.arguments);
        }

        console.log(`[Agent] Executing tool: ${toolName}`, args);
        const toolStart = Date.now();
        const result = await executeTool(ctx, toolName, args, executionContext);
        const toolDuration = Date.now() - toolStart;

        toolCallDetails.push({ tool: toolName, args, result, durationMs: toolDuration });

        // Only count tool as "used" if it didn't explicitly fail.
        // Tools like reply_in_thread and add_reaction return { success: false }
        // on error — we don't want those to suppress fallback acknowledgment.
        const resultObj = result as Record<string, unknown> | null;
        if (!resultObj || resultObj.success !== false) {
          toolsUsed.push(toolName);
        }

        // Add tool result to conversation
        messages.push({
          role: "tool",
          content: JSON.stringify(result),
          tool_call_id: call.id,
        });
      }

      // Continue loop — model will see tool results and decide next action
      continue;
    }

    // No tool calls — model is done. Return the text response.
    return {
      response: choice.message.content,
      toolsUsed,
      toolCallDetails,
      iterations: i + 1,
    };
  }

  // Hit max iterations
  console.warn(`[Agent] Hit max iterations (${maxIterations})`);
  return {
    response: null,
    toolsUsed,
    toolCallDetails,
    iterations: maxIterations,
  };
}
