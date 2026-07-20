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
    expect(email.subject).toBe(
      "[Togather error report] Togather error report — TypeError"
    );
    expect(email.text).toBe("Technical details here");
    expect(email.from).toBeTruthy();
  });

  test("always applies a fixed server-side subject prefix, even to a fabricated subject", () => {
    const email = buildErrorReportEmail({
      subject: "URGENT: wire money now",
      body: "body",
    });
    expect(email.subject).toBe("[Togather error report] URGENT: wire money now");
    expect(email.subject.startsWith("[Togather error report] ")).toBe(true);
  });

  test("falls back to a default subject when the client sends an empty/blank one", () => {
    const email = buildErrorReportEmail({ subject: "   ", body: "body" });
    expect(email.subject).toBe("[Togather error report] Togather error report");
  });

  test("caps an oversized subject server-side (prefix applied after capping)", () => {
    const email = buildErrorReportEmail({
      subject: "x".repeat(500),
      body: "body",
    });
    // The 200-char cap applies to the client-supplied portion; the fixed
    // prefix is added on top of that, so total length can exceed 200.
    expect(email.subject.startsWith("[Togather error report] ")).toBe(true);
    expect(
      email.subject.length - "[Togather error report] ".length
    ).toBeLessThanOrEqual(200);
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
  test("returns { success: false, reason: 'unavailable' } when Resend is unavailable (no crash, no throw)", async () => {
    const t = convexTest(schema, modules);
    const prevKey = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      const result = await t.action(
        api.functions.support.sendErrorReport.sendErrorReport,
        {
          subject: "Togather error report — TypeError",
          body: "Error: boom\nStack: ...",
          reportKey: "device-abc",
        }
      );
      expect(result).toEqual({ success: false, reason: "unavailable" });
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
    ).resolves.toEqual({ success: false, reason: "unavailable" });
  });

  test("is callable without a reportKey (falls back to the 'anonymous' bucket)", async () => {
    const t = convexTest(schema, modules);
    delete process.env.RESEND_API_KEY;
    await expect(
      t.action(api.functions.support.sendErrorReport.sendErrorReport, {
        subject: "subject",
        body: "body",
      })
    ).resolves.toEqual({ success: false, reason: "unavailable" });

    const bucket = await t.run(async (ctx) => {
      return ctx.db
        .query("rateLimits")
        .withIndex("by_key", (q) => q.eq("key", "error-report:key:anonymous"))
        .first();
    });
    expect(bucket).not.toBeNull();
  });

  test("sanitizes a malformed/oversized reportKey before using it as a rate-limit bucket key", async () => {
    const t = convexTest(schema, modules);
    delete process.env.RESEND_API_KEY;

    const maliciousKey = "../../etc/passwd".repeat(10); // contains '/', '.', and is way over the length cap
    await t.action(api.functions.support.sendErrorReport.sendErrorReport, {
      subject: "subject",
      body: "body",
      reportKey: maliciousKey,
    });

    const buckets = await t.run(async (ctx) => ctx.db.query("rateLimits").collect());
    // No bucket key should contain the raw malicious characters or exceed a
    // sane length — sanitizeReportKey must have stripped/capped it.
    for (const bucket of buckets) {
      expect(bucket.key).not.toContain("..");
      expect(bucket.key.length).toBeLessThan(100);
    }
  });

  test("rate limits per-key after repeated calls from the same reportKey (reason: rate_limited)", async () => {
    const t = convexTest(schema, modules);
    delete process.env.RESEND_API_KEY;

    // Pre-fill this caller's own bucket at its cap (5/hour) so the next call
    // from the same key is rejected without needing 5 real invocations.
    await t.run(async (ctx) => {
      await ctx.db.insert("rateLimits", {
        key: "error-report:key:device-xyz",
        attempts: 5,
        windowStart: Date.now(),
      });
    });

    const result = await t.action(
      api.functions.support.sendErrorReport.sendErrorReport,
      { subject: "subject", body: "body", reportKey: "device-xyz" }
    );
    expect(result).toEqual({ success: false, reason: "rate_limited" });
  });

  test("a different reportKey is NOT blocked by another key's exhausted bucket", async () => {
    const t = convexTest(schema, modules);
    delete process.env.RESEND_API_KEY;

    await t.run(async (ctx) => {
      await ctx.db.insert("rateLimits", {
        key: "error-report:key:device-exhausted",
        attempts: 5,
        windowStart: Date.now(),
      });
    });

    // A fresh key should still be allowed through to the (unconfigured
    // Resend) send path, i.e. fail with "unavailable", not "rate_limited".
    const result = await t.action(
      api.functions.support.sendErrorReport.sendErrorReport,
      { subject: "subject", body: "body", reportKey: "device-fresh" }
    );
    expect(result).toEqual({ success: false, reason: "unavailable" });
  });

  test("falls back to the global backstop once it's exhausted, even with distinct per-key buckets", async () => {
    const t = convexTest(schema, modules);
    delete process.env.RESEND_API_KEY;

    await t.run(async (ctx) => {
      await ctx.db.insert("rateLimits", {
        key: "error-report:global",
        attempts: 500,
        windowStart: Date.now(),
      });
    });

    const result = await t.action(
      api.functions.support.sendErrorReport.sendErrorReport,
      { subject: "subject", body: "body", reportKey: "brand-new-key" }
    );
    expect(result).toEqual({ success: false, reason: "rate_limited" });
  });
});
