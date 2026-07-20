/**
 * Error Report Support Email Tests
 *
 * Tests the sendErrorReport action (ErrorBoundary "Send to developer" flow)
 * and its pure helpers, following the pattern in password-reset.test.ts
 * (no live Resend calls; RESEND_API_KEY absent in tests).
 */

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "../schema";
import { modules } from "../test.setup";
import { api } from "../_generated/api";
import {
  buildErrorReportEmail,
  capLength,
} from "../functions/support/sendErrorReport";

describe("capLength", () => {
  test("returns the original string when under the limit", () => {
    expect(capLength("hello", 10)).toBe("hello");
  });

  test("returns the original string when exactly at the limit", () => {
    expect(capLength("hello", 5)).toBe("hello");
  });

  test("truncates and appends a marker when over the limit", () => {
    const result = capLength("a".repeat(100), 20);
    expect(result.length).toBe(20);
    expect(result.endsWith("… [truncated]")).toBe(true);
    expect(result.startsWith("a".repeat(20 - "\n… [truncated]".length))).toBe(
      true
    );
  });
});

describe("buildErrorReportEmail", () => {
  test("builds a payload addressed to the support inbox", () => {
    const email = buildErrorReportEmail({
      subject: "Togather error report — TypeError",
      body: "Technical details here",
    });

    expect(email.to).toBe("togather@supa.media");
    expect(email.subject).toBe("Togather error report — TypeError");
    expect(email.text).toBe("Technical details here");
    expect(email.from).toBeTruthy();
  });

  test("falls back to a default subject when the client sends an empty/blank one", () => {
    const email = buildErrorReportEmail({ subject: "   ", body: "body" });
    expect(email.subject).toBe("Togather error report");
  });

  test("caps an oversized subject server-side", () => {
    const email = buildErrorReportEmail({
      subject: "x".repeat(500),
      body: "body",
    });
    expect(email.subject.length).toBeLessThanOrEqual(200);
    expect(email.subject.endsWith("… [truncated]")).toBe(true);
  });

  test("caps an oversized body server-side", () => {
    const email = buildErrorReportEmail({
      subject: "subject",
      body: "y".repeat(50000),
    });
    expect(email.text.length).toBeLessThanOrEqual(20000);
    expect(email.text.endsWith("… [truncated]")).toBe(true);
  });

  test("never trusts a client-supplied recipient (no recipient field accepted)", () => {
    const email = buildErrorReportEmail({
      subject: "subject",
      body: "body",
      // @ts-expect-error - `to` is intentionally not part of the accepted args
      to: "attacker@example.com",
    });
    expect(email.to).toBe("togather@supa.media");
  });
});

describe("sendErrorReport action", () => {
  test("returns success: false when Resend is unavailable (no crash, no throw)", async () => {
    const t = convexTest(schema, modules);
    const prevKey = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      const result = await t.action(
        api.functions.support.sendErrorReport.sendErrorReport,
        {
          subject: "Togather error report — TypeError",
          body: "Error: boom\nStack: ...",
        }
      );
      expect(result).toEqual({ success: false });
    } finally {
      if (prevKey !== undefined) process.env.RESEND_API_KEY = prevKey;
    }
  });

  test("is callable without an auth token (unauthenticated action)", async () => {
    const t = convexTest(schema, modules);
    delete process.env.RESEND_API_KEY;
    // No t.withIdentity(...) — this must not throw an auth error.
    await expect(
      t.action(api.functions.support.sendErrorReport.sendErrorReport, {
        subject: "subject",
        body: "body",
      })
    ).resolves.toEqual({ success: false });
  });

  test("rate limits after repeated calls within the window", async () => {
    const t = convexTest(schema, modules);
    delete process.env.RESEND_API_KEY;

    // Pre-fill the shared rate limit bucket at its cap so the next call
    // is rejected without needing 100 real invocations.
    await t.run(async (ctx) => {
      await ctx.db.insert("rateLimits", {
        key: "error-report:global",
        attempts: 100,
        windowStart: Date.now(),
      });
    });

    const result = await t.action(
      api.functions.support.sendErrorReport.sendErrorReport,
      { subject: "subject", body: "body" }
    );
    expect(result).toEqual({ success: false });
  });
});
