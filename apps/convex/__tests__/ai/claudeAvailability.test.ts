/**
 * Claude model availability + fallback tests.
 *
 * Exercises the REAL exported helpers from `lib/ai/claudeAvailability.ts`
 * with an injected `fetch` so no network is touched:
 *   - isModelStatusAvailable / describeUnavailableStatus (pure)
 *   - checkClaudeModelAvailability (single-model probe)
 *   - selectAvailableClaudeModel (Opus → Sonnet fallback chain)
 *
 * Run with: cd apps/convex && pnpm test claudeAvailability
 */

import { describe, it, expect, vi } from "vitest";
import {
  CLAUDE_PRIMARY_MODEL,
  CLAUDE_FALLBACK_MODEL,
  CLAUDE_FALLBACK_CHAIN,
  CLAUDE_POLL_INTERVAL_MS,
  isModelStatusAvailable,
  describeUnavailableStatus,
  checkClaudeModelAvailability,
  selectAvailableClaudeModel,
} from "../../lib/ai/claudeAvailability";

/**
 * Build a fake `fetch` that answers by the model id at the end of the URL.
 * A value of "throw" simulates a network error for that model.
 */
function fakeFetch(byModel: Record<string, number | "throw">): typeof fetch {
  return (async (url: string | URL) => {
    const model = String(url).split("/").pop() as string;
    const outcome = byModel[model];
    if (outcome === undefined) throw new Error(`unexpected model ${model}`);
    if (outcome === "throw") throw new Error("network down");
    return { status: outcome } as Response;
  }) as unknown as typeof fetch;
}

describe("constants", () => {
  it("prefers Opus then Sonnet in the fallback chain", () => {
    expect(CLAUDE_PRIMARY_MODEL).toBe("claude-opus-4-8");
    expect(CLAUDE_FALLBACK_MODEL).toBe("claude-sonnet-4-6");
    expect(CLAUDE_FALLBACK_CHAIN).toEqual([
      "claude-opus-4-8",
      "claude-sonnet-4-6",
    ]);
  });

  it("polls hourly when nothing is available", () => {
    expect(CLAUDE_POLL_INTERVAL_MS).toBe(60 * 60 * 1000);
  });
});

describe("isModelStatusAvailable", () => {
  it("treats 200 as available", () => {
    expect(isModelStatusAvailable(200)).toBe(true);
  });

  it("treats every non-200 status as unavailable", () => {
    for (const s of [401, 403, 404, 429, 500, 529]) {
      expect(isModelStatusAvailable(s)).toBe(false);
    }
  });
});

describe("describeUnavailableStatus", () => {
  it("maps common down/overloaded statuses to readable reasons", () => {
    expect(describeUnavailableStatus(404)).toBe("model not found");
    expect(describeUnavailableStatus(401)).toBe("not authorized for this model");
    expect(describeUnavailableStatus(403)).toBe("not authorized for this model");
    expect(describeUnavailableStatus(429)).toBe("rate limited");
    expect(describeUnavailableStatus(529)).toBe("overloaded");
    expect(describeUnavailableStatus(500)).toBe("service error (500)");
    expect(describeUnavailableStatus(418)).toBe("unexpected status 418");
  });
});

describe("checkClaudeModelAvailability", () => {
  it("returns available for a 200 response", async () => {
    const result = await checkClaudeModelAvailability(CLAUDE_PRIMARY_MODEL, {
      apiKey: "test-key",
      fetchImpl: fakeFetch({ [CLAUDE_PRIMARY_MODEL]: 200 }),
    });
    expect(result).toEqual({
      model: CLAUDE_PRIMARY_MODEL,
      available: true,
      status: 200,
    });
  });

  it("returns unavailable with a reason for a non-200 response", async () => {
    const result = await checkClaudeModelAvailability(CLAUDE_PRIMARY_MODEL, {
      apiKey: "test-key",
      fetchImpl: fakeFetch({ [CLAUDE_PRIMARY_MODEL]: 529 }),
    });
    expect(result.available).toBe(false);
    expect(result.status).toBe(529);
    expect(result.reason).toBe("overloaded");
  });

  it("never throws on a network failure — resolves to unavailable", async () => {
    const result = await checkClaudeModelAvailability(CLAUDE_PRIMARY_MODEL, {
      apiKey: "test-key",
      fetchImpl: fakeFetch({ [CLAUDE_PRIMARY_MODEL]: "throw" }),
    });
    expect(result.available).toBe(false);
    expect(result.reason).toBe("request failed");
  });

  it("sends the x-api-key and anthropic-version headers", async () => {
    const spy = vi.fn(async () => ({ status: 200 }) as Response);
    await checkClaudeModelAvailability(CLAUDE_PRIMARY_MODEL, {
      apiKey: "secret-123",
      fetchImpl: spy as unknown as typeof fetch,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `https://api.anthropic.com/v1/models/${CLAUDE_PRIMARY_MODEL}`,
    );
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe(
      "secret-123",
    );
    expect(
      (init.headers as Record<string, string>)["anthropic-version"],
    ).toBe("2023-06-01");
  });
});

describe("selectAvailableClaudeModel", () => {
  it("selects the primary model and skips the fallback probe when Opus is up", async () => {
    const spy = vi.fn(async () => ({ status: 200 }) as Response);
    const selection = await selectAvailableClaudeModel({
      apiKey: "test-key",
      fetchImpl: spy as unknown as typeof fetch,
    });
    expect(selection.selectedModel).toBe(CLAUDE_PRIMARY_MODEL);
    expect(selection.statuses).toHaveLength(1);
    // Short-circuit: Sonnet must not be probed when Opus is healthy.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("falls back to Sonnet when Opus is down", async () => {
    const selection = await selectAvailableClaudeModel({
      apiKey: "test-key",
      fetchImpl: fakeFetch({
        [CLAUDE_PRIMARY_MODEL]: 529,
        [CLAUDE_FALLBACK_MODEL]: 200,
      }),
    });
    expect(selection.selectedModel).toBe(CLAUDE_FALLBACK_MODEL);
    expect(selection.statuses).toHaveLength(2);
    expect(selection.statuses[0].available).toBe(false);
    expect(selection.statuses[1].available).toBe(true);
  });

  it("returns null when every model in the chain is down", async () => {
    const selection = await selectAvailableClaudeModel({
      apiKey: "test-key",
      fetchImpl: fakeFetch({
        [CLAUDE_PRIMARY_MODEL]: 500,
        [CLAUDE_FALLBACK_MODEL]: 503,
      }),
    });
    expect(selection.selectedModel).toBeNull();
    expect(selection.statuses).toHaveLength(2);
    expect(selection.statuses.every((s) => !s.available)).toBe(true);
  });
});
