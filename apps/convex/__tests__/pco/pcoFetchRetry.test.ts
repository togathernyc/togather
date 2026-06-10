/**
 * Tests for `pcoFetchWithRetry` — the 429-aware retry used by the song-library
 * import's bulk fetches. Mocks global `fetch` (the real fetcher runs) to assert
 * it backs off on 429 honoring Retry-After and gives up after maxRetries.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  pcoFetchWithRetry,
  PcoApiError,
} from "../../lib/pcoServicesApi";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function rateLimited(retryAfterSeconds = 0): Response {
  return new Response("rate limited", {
    status: 429,
    headers: { "Retry-After": String(retryAfterSeconds) },
  });
}

afterEach(() => vi.restoreAllMocks());

describe("pcoFetchWithRetry", () => {
  it("retries on 429 (honoring Retry-After) then succeeds", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(rateLimited(0))
      .mockResolvedValueOnce(rateLimited(0))
      .mockResolvedValueOnce(jsonResponse({ data: ["ok"] }));

    const result = await pcoFetchWithRetry<{ data: string[] }>(
      "token",
      "https://api.planningcenteronline.com/services/v2/songs",
    );

    expect(result).toEqual({ data: ["ok"] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after maxRetries and rethrows the 429", async () => {
    // Fresh Response per call — a Response body can only be read once.
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      rateLimited(0),
    );

    await expect(
      pcoFetchWithRetry("token", "https://example.test", {}, 2),
    ).rejects.toMatchObject({ status: 429 });
  });

  it("does not retry non-429 errors", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response("nope", { status: 500 }));

    await expect(
      pcoFetchWithRetry("token", "https://example.test"),
    ).rejects.toBeInstanceOf(PcoApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
