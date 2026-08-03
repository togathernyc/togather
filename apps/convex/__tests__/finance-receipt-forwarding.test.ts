/**
 * Receipt attachment and provider forwarding (ADR-033 Phase 3).
 *
 * Two things ship together here and the second only makes sense given the
 * first: `attachExpenseReceipt` is the WRITE behind a read side that has
 * existed since ADR-032 (the "No receipt" badge, the red "receipt missing"
 * line, `canPay`'s receipt requirement) and never had one, because a card
 * charge is created by the settlement webhook before anyone has the paper.
 *
 * `forwardExpenseReceipt` then sends that image on to the issuer, but only
 * where the issuer has an API for it — BILL alone. The tests below pin the
 * capability boundary in both directions, because the cost of getting it wrong
 * is UI copy that promises the church's BILL account got a receipt it didn't.
 *
 * Run with: cd apps/convex && pnpm test __tests__/finance-receipt-forwarding.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi, beforeEach } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { modules } from "../test.setup";
import type { Id } from "../_generated/dataModel";
import { generateTokens } from "../lib/auth";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";
process.env.CREDENTIALS_MASTER_KEY = btoa(
  String.fromCharCode(...new Uint8Array(32).fill(7)),
);
process.env.R2_PUBLIC_URL = "https://cdn.example.test";

vi.useFakeTimers();

/**
 * The BILL client, stubbed at the module boundary.
 *
 * `uploadBillReceipt` is left REAL and its three HTTP calls are driven through
 * a stubbed `fetch` instead — the whole point of the flow is that it is three
 * calls in a specific order with the url from step 1 reappearing in step 3, and
 * mocking the wrapper would assert nothing about that.
 */
const bill = vi.hoisted(() => ({
  createBillCard: vi.fn(async () => ({
    uuid: "card_bill_1",
    status: "ACTIVE",
    lastFour: "4242",
  })),
  listBillBudgets: vi.fn(async () => ({
    results: [{ uuid: "budget_1", name: "Youth Ministry · Togather" }],
    nextPage: null,
  })),
  listBillUsers: vi.fn(async () => ({
    results: [{ uuid: "user_bill_1", email: "cardholder@example.test" }],
    nextPage: null,
  })),
  getBillCurrentUser: vi.fn(async () => ({
    uuid: "user_bill_1",
    email: "admin@example.test",
    companyName: "BILL Church",
  })),
  createBillWebhookSubscription: vi.fn(async () => ({ uuid: "sub_1" })),
}));

vi.mock("../lib/finance/bill", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/finance/bill")>()),
  ...bill,
}));

const UPLOAD_URL = "https://uploads.bill.test/signed/abc123";

/** Every `fetch` the code under test made, in order. */
let fetchCalls: Array<{ url: string; init: RequestInit | undefined }>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchCalls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: any, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      fetchCalls.push({ url, init });

      // The receipt image, served from R2.
      if (url.startsWith("https://cdn.example.test")) {
        return new Response(new Uint8Array([1, 2, 3]).buffer, {
          status: 200,
          headers: { "Content-Type": "image/jpeg" },
        });
      }
      // Step 1: BILL mints an upload url.
      if (url.endsWith("/v3/spend/transactions/receipt-upload-url")) {
        return new Response(JSON.stringify({ url: UPLOAD_URL }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // Step 2: the PUT to that url.
      if (url === UPLOAD_URL) return new Response("", { status: 200 });
      // Step 3: attach it to the transaction.
      if (url.includes("/receipts")) {
        return new Response("", { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }),
  );
});

const ADDRESS = {
  addressLine1: "1 Main St",
  city: "Austin",
  state: "TX",
  zipCode: "78701",
};

interface Fixture {
  communityId: Id<"communities">;
  fundId: Id<"funds">;
  primaryAdminUserId: Id<"users">;
  cardholderUserId: Id<"users">;
  outsiderUserId: Id<"users">;
}

async function seed(
  t: ReturnType<typeof convexTest>,
  provider: "bill" | "privacy" | "increase",
): Promise<Fixture> {
  return await t.run(async (ctx) => {
    await ctx.db.insert("featureFlags", {
      key: "group-giving",
      enabled: true,
      updatedAt: Date.now(),
    });
    const timestamp = Date.now();
    const suffix = Math.floor(Math.random() * 1_000_000);

    const communityId = await ctx.db.insert("communities", {
      name: "Receipt Church",
      slug: `receipt-church-${suffix}`,
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

    const mkUser = async (name: string, roles: number, inGroup = true) => {
      const userId = await ctx.db.insert("users", {
        firstName: name,
        lastName: "User",
        email: `${name.toLowerCase()}@example.test`,
        phone: `+1555${Math.floor(Math.random() * 9_000_000 + 1_000_000)}`,
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await ctx.db.insert("userCommunities", {
        userId,
        communityId,
        roles,
        status: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      if (inGroup) {
        await ctx.db.insert("groupMembers", {
          groupId,
          userId,
          role: "member",
          joinedAt: timestamp,
          notificationsEnabled: true,
        });
      }
      return userId;
    };

    const primaryAdminUserId = await mkUser("Primary", 4);
    const cardholderUserId = await mkUser("Cardholder", 1);
    const outsiderUserId = await mkUser("Outsider", 1, false);

    const fundId = await ctx.db.insert("funds", {
      communityId,
      groupId,
      name: "Youth Ministry",
      type: "group",
      status: "active",
      balanceCents: 100_000,
      ...(provider === "increase"
        ? { increaseAccountId: "increase_account_1" }
        : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await ctx.db.insert("communityFinance", {
      communityId,
      stripeConnectedAccountId: "acct_receipt",
      onboardingStatus: "live",
      cardProvider: provider,
      ...(provider === "increase" ? { increaseEntityId: "entity_1" } : {}),
      legalName: "Receipt Church",
      ein: "12-3456789",
      address: ADDRESS,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await ctx.db.insert("fundRoles", {
      fundId,
      userId: cardholderUserId,
      role: "cardholder",
      grantedBy: primaryAdminUserId,
      grantedAt: timestamp,
    });

    return {
      communityId,
      fundId,
      primaryAdminUserId,
      cardholderUserId,
      outsiderUserId,
    };
  });
}

async function tokenFor(userId: Id<"users">): Promise<string> {
  return (await generateTokens(userId)).accessToken;
}

/** A provisioned card and a settled card-charge expense on it, with no receipt. */
async function seedCardCharge(
  t: ReturnType<typeof convexTest>,
  f: Fixture,
  provider: "bill" | "privacy" | "increase",
): Promise<{ cardId: Id<"cards">; expenseId: Id<"expenses"> }> {
  return await t.run(async (ctx) => {
    const timestamp = Date.now();
    const cardId = await ctx.db.insert("cards", {
      fundId: f.fundId,
      holderUserId: f.cardholderUserId,
      name: "Supplies",
      provider,
      providerCardId: `card_${provider}_1`,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const expenseId = await ctx.db.insert("expenses", {
      fundId: f.fundId,
      submitterId: f.cardholderUserId,
      amountCents: 4_200,
      kind: "card_charge",
      description: "OFFICE SUPPLY CO",
      status: "pending",
      cardId,
      increaseTransactionId: "txn_provider_1",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return { cardId, expenseId };
  });
}

/** Mint the `uploadGrants` row an r2 key needs to be attachable. */
async function grantUpload(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  key: string,
  contentType = "image/jpeg",
): Promise<string> {
  await t.run(async (ctx) => {
    await ctx.db.insert("uploadGrants", {
      storagePath: key,
      userId,
      folder: "uploads",
      contentType,
      createdAt: Date.now(),
    });
  });
  return key;
}

async function connectBill(t: ReturnType<typeof convexTest>, f: Fixture) {
  await t.action(
    api.functions.finance.cardProviderConnections.connectCardProvider,
    {
      token: await tokenFor(f.primaryAdminUserId),
      communityId: f.communityId,
      provider: "bill",
      apiKey: "bill_token_do_not_log",
    },
  );
}

// ============================================================================
// attachExpenseReceipt
// ============================================================================

describe("attachExpenseReceipt", () => {
  test("the cardholder attaches a receipt to their own card charge", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t, "increase");
    const { expenseId } = await seedCardCharge(t, f, "increase");
    const key = await grantUpload(t, f.cardholderUserId, "r2:uploads/a.jpg");

    await t.mutation(api.functions.finance.expenses.attachExpenseReceipt, {
      token: await tokenFor(f.cardholderUserId),
      expenseId,
      receiptKey: key,
    });

    const expense = await t.run(async (ctx) => ctx.db.get(expenseId));
    expect(expense!.receiptKey).toBe(key);

    const events = await t.run(async (ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_fund", (q) => q.eq("fundId", f.fundId))
        .collect(),
    );
    expect(events.some((e) => e.action === "expense.receipt_attached")).toBe(
      true,
    );
  });

  test("someone else's uploaded key is refused", async () => {
    // Receipt URLs are visible to every manager+ viewer of a fund, so "I know
    // the key" must never be the same as "it's mine".
    const t = convexTest(schema, modules);
    const f = await seed(t, "increase");
    const { expenseId } = await seedCardCharge(t, f, "increase");
    const key = await grantUpload(t, f.outsiderUserId, "r2:uploads/theirs.jpg");

    await expect(
      t.mutation(api.functions.finance.expenses.attachExpenseReceipt, {
        token: await tokenFor(f.cardholderUserId),
        expenseId,
        receiptKey: key,
      }),
    ).rejects.toThrow(/wasn't uploaded from this account/i);
  });

  test("a stranger to the fund cannot attach", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t, "increase");
    const { expenseId } = await seedCardCharge(t, f, "increase");
    const key = await grantUpload(t, f.outsiderUserId, "r2:uploads/b.jpg");

    await expect(
      t.mutation(api.functions.finance.expenses.attachExpenseReceipt, {
        token: await tokenFor(f.outsiderUserId),
        expenseId,
        receiptKey: key,
      }),
    ).rejects.toThrow();
  });

  test("re-attaching the SAME key does not queue a second forward", async () => {
    // A double-tap, or a client retry of a mutation that already committed,
    // sends the identical key twice. Both runs would pass the staleness guard
    // (the key IS still current) and BILL would file the same image twice.
    const t = convexTest(schema, modules);
    const f = await seed(t, "bill");
    await connectBill(t, f);
    const { expenseId } = await seedCardCharge(t, f, "bill");
    const key = await grantUpload(t, f.cardholderUserId, "r2:uploads/same.jpg");

    for (let i = 0; i < 2; i += 1) {
      await t.mutation(api.functions.finance.expenses.attachExpenseReceipt, {
        token: await tokenFor(f.cardholderUserId),
        expenseId,
        receiptKey: key,
      });
    }

    const queued = await t.run(async (ctx) => {
      const rows = await ctx.db.system.query("_scheduled_functions").collect();
      return rows.filter((r) => r.name.includes("forwardExpenseReceipt"))
        .length;
    });
    expect(queued).toBe(1);
  });

  test("a reimbursement is refused — its receipt comes from submission", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t, "increase");
    const expenseId = await t.run(async (ctx) => {
      const timestamp = Date.now();
      return await ctx.db.insert("expenses", {
        fundId: f.fundId,
        submitterId: f.cardholderUserId,
        amountCents: 1_000,
        kind: "reimbursement",
        receiptKey: "r2:uploads/original.jpg",
        status: "pending",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });
    const key = await grantUpload(t, f.cardholderUserId, "r2:uploads/new.jpg");

    await expect(
      t.mutation(api.functions.finance.expenses.attachExpenseReceipt, {
        token: await tokenFor(f.cardholderUserId),
        expenseId,
        receiptKey: key,
      }),
    ).rejects.toThrow(/card charge/i);
  });
});

// ============================================================================
// Forwarding — the capability boundary
// ============================================================================

describe("forwarding to the card provider", () => {
  test("a BILL card charge queues a forward; a Privacy one does not", async () => {
    for (const [provider, expected] of [
      ["bill", 1],
      ["privacy", 0],
      ["increase", 0],
    ] as const) {
      const t = convexTest(schema, modules);
      const f = await seed(t, provider);
      const { expenseId } = await seedCardCharge(t, f, provider);
      const key = await grantUpload(
        t,
        f.cardholderUserId,
        `r2:uploads/${provider}.jpg`,
      );

      await t.mutation(api.functions.finance.expenses.attachExpenseReceipt, {
        token: await tokenFor(f.cardholderUserId),
        expenseId,
        receiptKey: key,
      });

      const queued = await t.run(async (ctx) => {
        const rows = await ctx.db.system
          .query("_scheduled_functions")
          .collect();
        return rows.filter(
          (r) =>
            r.name.includes("forwardExpenseReceipt") &&
            r.state.kind === "pending",
        ).length;
      });
      expect(queued, `provider ${provider}`).toBe(expected);
    }
  });

  test("BILL's documented three-step upload, in order, with the url reused", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t, "bill");
    await connectBill(t, f);
    const { expenseId } = await seedCardCharge(t, f, "bill");
    const key = await grantUpload(t, f.cardholderUserId, "r2:uploads/c.jpg");

    await t.mutation(api.functions.finance.expenses.attachExpenseReceipt, {
      token: await tokenFor(f.cardholderUserId),
      expenseId,
      receiptKey: key,
    });
    fetchCalls = [];
    const result = await t.action(
      internal.functions.finance.expenses.forwardExpenseReceipt,
      { expenseId, receiptKey: key },
    );
    expect(result).toEqual({ forwarded: true });

    // 1. read the image, 2. mint the url, 3. PUT to it, 4. attach it.
    expect(fetchCalls[0].url).toBe("https://cdn.example.test/uploads/c.jpg");
    expect(fetchCalls[1].url).toContain(
      "/v3/spend/transactions/receipt-upload-url",
    );
    expect(fetchCalls[1].init?.method).toBe("POST");

    expect(fetchCalls[2].url).toBe(UPLOAD_URL);
    expect(fetchCalls[2].init?.method).toBe("PUT");
    expect((fetchCalls[2].init?.headers as any)["Content-Type"]).toBe(
      "image/jpeg",
    );
    // The pre-signed upload host is NOT BILL's API — sending the spending
    // credential there would leak it to a third party.
    expect((fetchCalls[2].init?.headers as any).apiToken).toBeUndefined();

    expect(fetchCalls[3].url).toContain(
      "/v3/spend/transactions/txn_provider_1/receipts",
    );
    // Step 3 names the SAME url step 2 uploaded to — that identity is the
    // whole handle, and getting it wrong attaches an empty object.
    expect(JSON.parse(fetchCalls[3].init?.body as string)).toEqual({
      url: UPLOAD_URL,
    });

    const events = await t.run(async (ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_fund", (q) => q.eq("fundId", f.fundId))
        .collect(),
    );
    expect(events.some((e) => e.action === "expense.receipt_forwarded")).toBe(
      true,
    );
  });

  test("a card whose issuer is no longer the community's connection forwards NOTHING", async () => {
    // A church closes its BILL cards and connects a different issuer. The old
    // BILL card_charge rows stay in the history, and a receipt attached to one
    // of them would address BILL's endpoint while holding the only credential
    // the community now has — the other vendor's — and send it as an `apiToken`
    // header to a vendor that never issued it.
    const t = convexTest(schema, modules);
    const f = await seed(t, "bill");
    await connectBill(t, f);
    const { expenseId } = await seedCardCharge(t, f, "bill");
    const key = await grantUpload(t, f.cardholderUserId, "r2:uploads/old.jpg");

    await t.mutation(api.functions.finance.expenses.attachExpenseReceipt, {
      token: await tokenFor(f.cardholderUserId),
      expenseId,
      receiptKey: key,
    });

    // The community switches issuers, leaving the BILL card behind.
    await t.run(async (ctx) => {
      const connection = await ctx.db
        .query("cardProviderConnections")
        .withIndex("by_community", (q) => q.eq("communityId", f.communityId))
        .first();
      await ctx.db.patch(connection!._id, { provider: "privacy" });
    });

    fetchCalls = [];
    const result = await t.action(
      internal.functions.finance.expenses.forwardExpenseReceipt,
      { expenseId, receiptKey: key },
    );
    expect(result).toEqual({ forwarded: false });
    // Not one request — not even the read of the image.
    expect(fetchCalls).toEqual([]);
  });

  test("a run whose receipt has since been REPLACED does nothing", async () => {
    // The dedupe half of the mechanism: with no `forwardedAt` column, "is this
    // run still current?" is answered by the receipt key itself.
    const t = convexTest(schema, modules);
    const f = await seed(t, "bill");
    await connectBill(t, f);
    const { expenseId } = await seedCardCharge(t, f, "bill");
    const first = await grantUpload(
      t,
      f.cardholderUserId,
      "r2:uploads/first.jpg",
    );
    const second = await grantUpload(
      t,
      f.cardholderUserId,
      "r2:uploads/second.jpg",
    );

    await t.mutation(api.functions.finance.expenses.attachExpenseReceipt, {
      token: await tokenFor(f.cardholderUserId),
      expenseId,
      receiptKey: first,
    });
    await t.mutation(api.functions.finance.expenses.attachExpenseReceipt, {
      token: await tokenFor(f.cardholderUserId),
      expenseId,
      receiptKey: second,
    });

    fetchCalls = [];
    // The FIRST photo's run, arriving after the replacement.
    const stale = await t.action(
      internal.functions.finance.expenses.forwardExpenseReceipt,
      { expenseId, receiptKey: first },
    );
    expect(stale).toEqual({ forwarded: false });
    expect(fetchCalls).toHaveLength(0);

    // The second one still goes.
    const current = await t.action(
      internal.functions.finance.expenses.forwardExpenseReceipt,
      { expenseId, receiptKey: second },
    );
    expect(current).toEqual({ forwarded: true });
  });

  test("a format BILL cannot open is refused before it is uploaded", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t, "bill");
    await connectBill(t, f);
    const { expenseId } = await seedCardCharge(t, f, "bill");
    const key = await grantUpload(
      t,
      f.cardholderUserId,
      "r2:uploads/scan.pdf",
      "application/pdf",
    );

    await t.mutation(api.functions.finance.expenses.attachExpenseReceipt, {
      token: await tokenFor(f.cardholderUserId),
      expenseId,
      receiptKey: key,
    });
    const result = await t.action(
      internal.functions.finance.expenses.forwardExpenseReceipt,
      { expenseId, receiptKey: key },
    );
    expect(result).toEqual({ forwarded: false });

    const events = await t.run(async (ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_fund", (q) => q.eq("fundId", f.fundId))
        .collect(),
    );
    const failure = events.find(
      (e) => e.action === "expense.receipt_forward_failed",
    );
    expect(failure).toBeDefined();
    expect(JSON.parse(failure!.detailsJson!).message).toMatch(/JPG and PNG/i);
  });

  test("a provider failure never undoes the receipt", async () => {
    // The receipt is already durable in Togather and the church's own books
    // are complete without the copy at the issuer.
    const t = convexTest(schema, modules);
    const f = await seed(t, "bill");
    await connectBill(t, f);
    const { expenseId } = await seedCardCharge(t, f, "bill");
    const key = await grantUpload(t, f.cardholderUserId, "r2:uploads/d.jpg");

    await t.mutation(api.functions.finance.expenses.attachExpenseReceipt, {
      token: await tokenFor(f.cardholderUserId),
      expenseId,
      receiptKey: key,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: any) => {
        const url = typeof input === "string" ? input : String(input);
        if (url.startsWith("https://cdn.example.test")) {
          return new Response(new Uint8Array([1]).buffer, {
            status: 200,
            headers: { "Content-Type": "image/jpeg" },
          });
        }
        return new Response("BILL is having a moment", { status: 503 });
      }),
    );

    const result = await t.action(
      internal.functions.finance.expenses.forwardExpenseReceipt,
      { expenseId, receiptKey: key },
    );
    expect(result).toEqual({ forwarded: false });

    const expense = await t.run(async (ctx) => ctx.db.get(expenseId));
    expect(expense!.receiptKey).toBe(key);
  });
});
