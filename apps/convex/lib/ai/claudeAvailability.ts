/**
 * Claude model availability + fallback.
 *
 * Before the Togather Bot hands a task to a Claude model, it should confirm a
 * model is actually reachable. This module probes Anthropic's Models API
 * (`GET /v1/models/{id}`) and walks a preference chain:
 *
 *   1. Claude Opus   (`claude-opus-4-8`)   — primary
 *   2. Claude Sonnet (`claude-sonnet-4-6`) — fallback
 *
 * It returns the first model that responds healthy, or `null` when both are
 * down. The Convex layer (`functions/ai/modelAvailability.ts`) wraps this to
 * notify the thread and schedule an hourly poll when nothing is available.
 *
 * Everything here is pure and `fetch`-injectable so it can be unit-tested
 * without network access (see `__tests__/ai/claudeAvailability.test.ts`).
 */

/** Primary model the bot prefers for executing tasks. */
export const CLAUDE_PRIMARY_MODEL = "claude-opus-4-8";

/** Fallback used when the primary model is unavailable. */
export const CLAUDE_FALLBACK_MODEL = "claude-sonnet-4-6";

/** Preference order: try Opus first, then Sonnet. */
export const CLAUDE_FALLBACK_CHAIN = [
  CLAUDE_PRIMARY_MODEL,
  CLAUDE_FALLBACK_MODEL,
] as const;

/** Poll cadence when no Claude model is reachable: once per hour. */
export const CLAUDE_POLL_INTERVAL_MS = 60 * 60 * 1000;

const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_TIMEOUT_MS = 15_000;

export interface ClaudeModelStatus {
  model: string;
  available: boolean;
  /** HTTP status from the Models API probe, when a response was received. */
  status?: number;
  /** Human-readable reason, only set when unavailable. */
  reason?: string;
}

/**
 * Interpret a Models API HTTP status into availability.
 *
 * A `200` means the model is served and the key can reach it. Everything else
 * — `404` (retired/unknown id), `401`/`403` (no access), `429` (rate limited),
 * `5xx`/`529` (overloaded/outage) — means the bot should not dispatch to it.
 */
export function isModelStatusAvailable(status: number): boolean {
  return status === 200;
}

/** Short explanation for an unavailable status, for logs and thread messages. */
export function describeUnavailableStatus(status: number): string {
  if (status === 404) return "model not found";
  if (status === 401 || status === 403) return "not authorized for this model";
  if (status === 429) return "rate limited";
  if (status === 529) return "overloaded";
  if (status >= 500) return `service error (${status})`;
  return `unexpected status ${status}`;
}

export interface ProbeOptions {
  /** Anthropic API key sent as the `x-api-key` header. */
  apiKey: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout; defaults to 15s. */
  timeoutMs?: number;
}

/**
 * Probe a single Claude model. Never throws — a network failure or timeout
 * resolves to `{ available: false }` so callers can fall back cleanly.
 */
export async function checkClaudeModelAvailability(
  model: string,
  opts: ProbeOptions,
): Promise<ClaudeModelStatus> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  try {
    const res = await fetchImpl(`${ANTHROPIC_MODELS_URL}/${model}`, {
      method: "GET",
      headers: {
        "x-api-key": opts.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      signal: controller.signal,
    });
    if (isModelStatusAvailable(res.status)) {
      return { model, available: true, status: res.status };
    }
    return {
      model,
      available: false,
      status: res.status,
      reason: describeUnavailableStatus(res.status),
    };
  } catch (err) {
    const reason =
      err instanceof Error && err.name === "AbortError"
        ? "request timed out"
        : "request failed";
    return { model, available: false, reason };
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface ModelSelection {
  /** First available model in preference order, or `null` if all are down. */
  selectedModel: string | null;
  /** Per-model probe results, in the order they were checked. */
  statuses: ClaudeModelStatus[];
}

/**
 * Walk the Opus → Sonnet chain and return the first available model.
 * Short-circuits: stops probing as soon as a healthy model is found, so a
 * healthy primary never triggers a fallback probe.
 */
export async function selectAvailableClaudeModel(
  opts: ProbeOptions & { chain?: readonly string[] },
): Promise<ModelSelection> {
  const chain = opts.chain ?? CLAUDE_FALLBACK_CHAIN;
  const statuses: ClaudeModelStatus[] = [];
  for (const model of chain) {
    const status = await checkClaudeModelAvailability(model, opts);
    statuses.push(status);
    if (status.available) {
      return { selectedModel: model, statuses };
    }
  }
  return { selectedModel: null, statuses };
}
