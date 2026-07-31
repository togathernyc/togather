/**
 * Receipt provenance across BOTH producers of `r2:` keys.
 *
 * `submitExpense` treats an `uploadGrants` row as proof that the caller
 * uploaded the receipt they're claiming. That only holds if every path that
 * hands out an `r2:` key can write one — and there are two: the presigned-URL
 * actions in functions/uploads.ts, and lib/r2.ts's `putR2Object`, which PUTs
 * bytes the server already holds. A receipt stored through the second path
 * with no grant would be refused as "not yours" despite being exactly that.
 *
 * The other half is the inverse risk: the grant write must never be able to
 * break an upload. It hangs off the presign action that serves chat images,
 * profile photos and group covers, so a failure there was able to stop every
 * upload in the product for the sake of a finance-only check.
 *
 * Run with: cd apps/convex && pnpm test __tests__/finance-receipt-provenance.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi, beforeEach } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../test.setup";
import { generateTokens } from "../lib/auth";
import type { Id } from "../_generated/dataModel";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

// Keep putR2Object off the network; we only care about the key it returns.
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    async send() {
      return {};
    }
  },
  PutObjectCommand: class {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
}));

import { putR2Object } from "../lib/r2";
import { recordUploadGrantBestEffort } from "../functions/uploads";

beforeEach(() => {
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct";
  process.env.R2_ACCESS_KEY_ID = "akid";
  process.env.R2_SECRET_ACCESS_KEY = "secret";
  process.env.R2_BUCKET_NAME = "bucket";
});

// ============================================================================
// Fixture: an active group fund a member can submit against
// ============================================================================

async function seedFundFixture(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const timestamp = Date.now();
    await ctx.db.insert("featureFlags", {
      key: "group-giving",
      enabled: true,
      updatedAt: timestamp,
    });
    const communityId = await ctx.db.insert("communities", {
      name: "Receipt Church",
      slug: `receipt-${Math.floor(Math.random() * 1_000_000)}`,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Small Group",
      slug: "small-group",
      isActive: true,
      createdAt: timestamp,
      displayOrder: 1,
    });
    const groupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Youth",
      isArchived: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const memberUserId = await ctx.db.insert("users", {
      phone: `+1555000${Math.floor(Math.random() * 9000 + 1000)}`,
      firstName: "Mia",
      lastName: "Member",
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: memberUserId,
      role: "member",
      joinedAt: timestamp,
      notificationsEnabled: true,
    });
    const fundId = await ctx.db.insert("funds", {
      communityId,
      groupId,
      name: "Youth Fund",
      type: "group" as const,
      status: "active" as const,
      balanceCents: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return { communityId, groupId, fundId, memberUserId };
  });
}

async function tokenFor(userId: Id<"users">): Promise<string> {
  const { accessToken } = await generateTokens(userId);
  return accessToken;
}

/** The `runMutation` seam putR2Object needs, backed by the test instance. */
function actionCtxFor(t: ReturnType<typeof convexTest>) {
  return { runMutation: (ref: any, args: any) => t.mutation(ref, args) } as any;
}

// ============================================================================
// putR2Object as a receipt producer
// ============================================================================

describe("putR2Object receipts", () => {
  test("a receipt stored server-side with grantTo is accepted by submitExpense", async () => {
    const t = convexTest(schema, modules);
    const { fundId, memberUserId } = await seedFundFixture(t);

    const { storagePath } = await putR2Object({
      folder: "uploads",
      fileName: "receipt.jpg",
      contentType: "image/jpeg",
      body: new ArrayBuffer(4),
      grantTo: { ctx: actionCtxFor(t), userId: memberUserId },
    });
    expect(storagePath.startsWith("r2:")).toBe(true);

    const expenseId = await t.mutation(
      api.functions.finance.expenses.submitExpense,
      {
        token: await tokenFor(memberUserId),
        fundId,
        amountCents: 4200,
        kind: "reimbursement",
        description: "Pizza",
        receiptKey: storagePath,
      },
    );
    const expense = await t.run((ctx) => ctx.db.get(expenseId));
    expect(expense?.receiptKey).toBe(storagePath);
  });

  test("a system upload (no grantTo) stays unclaimable", async () => {
    const t = convexTest(schema, modules);
    const { fundId, memberUserId } = await seedFundFixture(t);

    // PCO song files / dev-assistant config belong to nobody, deliberately.
    const { storagePath } = await putR2Object({
      folder: "uploads",
      fileName: "song.pdf",
      contentType: "application/pdf",
      body: new ArrayBuffer(4),
    });

    await expect(
      t.mutation(api.functions.finance.expenses.submitExpense, {
        token: await tokenFor(memberUserId),
        fundId,
        amountCents: 4200,
        kind: "reimbursement",
        description: "Not mine",
        receiptKey: storagePath,
      }),
    ).rejects.toThrow(/re-attach the photo/i);
  });

  test("a failed grant write leaves the object stored rather than throwing", async () => {
    // The bytes are already in R2 by the time the grant is written — throwing
    // would fail an upload that actually succeeded.
    const throwingCtx = {
      runMutation: async () => {
        throw new Error("write conflict");
      },
    } as any;

    await expect(
      putR2Object({
        folder: "uploads",
        fileName: "receipt.jpg",
        contentType: "image/jpeg",
        body: new ArrayBuffer(4),
        grantTo: { ctx: throwingCtx, userId: "users:fake" as Id<"users"> },
      }),
    ).resolves.toMatchObject({ storagePath: expect.stringMatching(/^r2:/) });
  });
});

// ============================================================================
// The grant write can never break an upload
// ============================================================================

describe("uploadGrants writes are non-fatal", () => {
  test("a throwing grant mutation does not propagate out of the presign path", async () => {
    const throwingCtx = {
      runMutation: async () => {
        throw new Error("uploadGrants unavailable");
      },
    } as any;

    // If this rejected, every upload in the product — chat images, profile
    // photos, group covers — would fail with it.
    await expect(
      recordUploadGrantBestEffort(throwingCtx, {
        storagePath: "r2:chat/abc.jpg",
        userId: "users:fake" as Id<"users">,
        folder: "chat",
        contentType: "image/jpeg",
      }),
    ).resolves.toBeUndefined();
  });

  test("the happy path still records the row the receipt check reads", async () => {
    const t = convexTest(schema, modules);
    const { memberUserId } = await seedFundFixture(t);

    await recordUploadGrantBestEffort(actionCtxFor(t), {
      storagePath: "r2:uploads/kept.jpg",
      userId: memberUserId,
      folder: "uploads",
      contentType: "image/jpeg",
    });
    // …twice: a retried presign must not write a second row.
    await recordUploadGrantBestEffort(actionCtxFor(t), {
      storagePath: "r2:uploads/kept.jpg",
      userId: memberUserId,
      folder: "uploads",
      contentType: "image/jpeg",
    });

    const grants = await t.run((ctx) =>
      ctx.db
        .query("uploadGrants")
        .withIndex("by_storagePath", (q) =>
          q.eq("storagePath", "r2:uploads/kept.jpg"),
        )
        .collect(),
    );
    expect(grants).toHaveLength(1);
    expect(grants[0].userId).toBe(memberUserId);
  });
});
