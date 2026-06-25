/**
 * Dev-Assistant Maintainers — access + role management tests.
 *
 * Covers the "maintainers managed by super admins" feature:
 * - the trigger gate (canUseDevAssistant / getUserAccess) admits superusers,
 *   staff, and dev maintainers but no one else;
 * - only super admins (superuser/staff) can grant/revoke/list maintainers;
 * - grant/revoke mutate `users.platformRoles` idempotently and without
 *   clobbering other platform roles.
 *
 * Auth is mocked (mirrors security-pii-exposure.test.ts): the token IS the
 * caller's user id, so each test "logs in" by passing a user id as the token.
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import {
  canUseDevAssistant,
  isDevAssistantSuperAdmin,
  DEV_MAINTAINER_ROLE,
} from "../functions/devAssistant/maintainers";
import type { Doc } from "../_generated/dataModel";

const modules = import.meta.glob([
  "../**/*.*s",
  "!../__mocks__/**",
  "!../__tests__/**",
]);

// Token == userId in these tests. requireAuthUser resolves the doc from the db.
vi.mock("../lib/auth", () => ({
  requireAuth: vi.fn(async (_ctx: any, token: string) => {
    if (!token) throw new Error("Not authenticated");
    return token;
  }),
  requireAuthUser: vi.fn(async (ctx: any, token: string) => {
    if (!token) throw new Error("Not authenticated");
    const user = await ctx.db.get(token);
    if (!user) throw new Error("User not found");
    return user;
  }),
}));

function user(overrides: Partial<Doc<"users">>): Partial<Doc<"users">> {
  return { isActive: true, ...overrides };
}

// ============================================================================
// Pure access helpers — the authorization decision
// ============================================================================

describe("canUseDevAssistant", () => {
  test("admits superusers, staff, and dev maintainers", () => {
    expect(canUseDevAssistant({ isSuperuser: true } as Doc<"users">)).toBe(true);
    expect(canUseDevAssistant({ isStaff: true } as Doc<"users">)).toBe(true);
    expect(
      canUseDevAssistant({
        platformRoles: [DEV_MAINTAINER_ROLE],
      } as Doc<"users">),
    ).toBe(true);
  });

  test("rejects everyone else", () => {
    expect(canUseDevAssistant(null)).toBe(false);
    expect(canUseDevAssistant(undefined)).toBe(false);
    expect(canUseDevAssistant({} as Doc<"users">)).toBe(false);
    expect(
      canUseDevAssistant({ platformRoles: ["poster_admin"] } as Doc<"users">),
    ).toBe(false);
  });
});

describe("isDevAssistantSuperAdmin", () => {
  test("only superusers and staff can manage maintainers", () => {
    expect(isDevAssistantSuperAdmin({ isSuperuser: true } as Doc<"users">)).toBe(
      true,
    );
    expect(isDevAssistantSuperAdmin({ isStaff: true } as Doc<"users">)).toBe(
      true,
    );
    // A maintainer is NOT a super admin — they can't manage the list.
    expect(
      isDevAssistantSuperAdmin({
        platformRoles: [DEV_MAINTAINER_ROLE],
      } as Doc<"users">),
    ).toBe(false);
    expect(isDevAssistantSuperAdmin(null)).toBe(false);
  });
});

// ============================================================================
// Trigger gate — getUserAccess (used by processThreadMention)
// ============================================================================

describe("getUserAccess (trigger gate)", () => {
  test("reports isMaintainer for delegated maintainers", async () => {
    const t = convexTest(schema, modules);
    const maintainerId = await t.run((ctx) =>
      ctx.db.insert("users", user({ platformRoles: [DEV_MAINTAINER_ROLE] })),
    );
    const access = await t.query(
      internal.functions.devAssistant.bugs.getUserAccess,
      { userId: maintainerId },
    );
    expect(access).toEqual({
      isStaff: false,
      isSuperuser: false,
      isMaintainer: true,
    });
  });

  test("a plain user is admitted by none of the gates", async () => {
    const t = convexTest(schema, modules);
    const plainId = await t.run((ctx) =>
      ctx.db.insert("users", user({ firstName: "Plain" })),
    );
    const access = await t.query(
      internal.functions.devAssistant.bugs.getUserAccess,
      { userId: plainId },
    );
    expect(access.isStaff || access.isSuperuser || access.isMaintainer).toBe(
      false,
    );
  });
});

// ============================================================================
// Management mutations — super admin only
// ============================================================================

describe("maintainer management", () => {
  test("grant adds the role; revoke removes it", async () => {
    const t = convexTest(schema, modules);
    const superId = await t.run((ctx) =>
      ctx.db.insert("users", user({ isSuperuser: true })),
    );
    const targetId = await t.run((ctx) =>
      ctx.db.insert("users", user({ firstName: "Target" })),
    );

    await t.mutation(api.functions.devAssistant.maintainers.grantMaintainer, {
      token: superId,
      userId: targetId,
    });
    let target = await t.run((ctx) => ctx.db.get(targetId));
    expect(target?.platformRoles).toContain(DEV_MAINTAINER_ROLE);

    await t.mutation(api.functions.devAssistant.maintainers.revokeMaintainer, {
      token: superId,
      userId: targetId,
    });
    target = await t.run((ctx) => ctx.db.get(targetId));
    expect(target?.platformRoles ?? []).not.toContain(DEV_MAINTAINER_ROLE);
  });

  test("grant is idempotent and preserves other platform roles", async () => {
    const t = convexTest(schema, modules);
    const superId = await t.run((ctx) =>
      ctx.db.insert("users", user({ isStaff: true })),
    );
    const targetId = await t.run((ctx) =>
      ctx.db.insert("users", user({ platformRoles: ["poster_admin"] })),
    );

    await t.mutation(api.functions.devAssistant.maintainers.grantMaintainer, {
      token: superId,
      userId: targetId,
    });
    await t.mutation(api.functions.devAssistant.maintainers.grantMaintainer, {
      token: superId,
      userId: targetId,
    });

    const target = await t.run((ctx) => ctx.db.get(targetId));
    expect(target?.platformRoles).toEqual(["poster_admin", DEV_MAINTAINER_ROLE]);
  });

  test("revoke preserves other platform roles", async () => {
    const t = convexTest(schema, modules);
    const superId = await t.run((ctx) =>
      ctx.db.insert("users", user({ isSuperuser: true })),
    );
    const targetId = await t.run((ctx) =>
      ctx.db.insert(
        "users",
        user({ platformRoles: ["poster_admin", DEV_MAINTAINER_ROLE] }),
      ),
    );

    await t.mutation(api.functions.devAssistant.maintainers.revokeMaintainer, {
      token: superId,
      userId: targetId,
    });

    const target = await t.run((ctx) => ctx.db.get(targetId));
    expect(target?.platformRoles).toEqual(["poster_admin"]);
  });

  test("non-superusers cannot grant", async () => {
    const t = convexTest(schema, modules);
    const maintainerId = await t.run((ctx) =>
      ctx.db.insert("users", user({ platformRoles: [DEV_MAINTAINER_ROLE] })),
    );
    const targetId = await t.run((ctx) =>
      ctx.db.insert("users", user({ firstName: "Target" })),
    );

    await expect(
      t.mutation(api.functions.devAssistant.maintainers.grantMaintainer, {
        token: maintainerId,
        userId: targetId,
      }),
    ).rejects.toThrow();
  });

  test("non-superusers cannot list maintainers", async () => {
    const t = convexTest(schema, modules);
    const plainId = await t.run((ctx) =>
      ctx.db.insert("users", user({ firstName: "Plain" })),
    );
    await expect(
      t.query(api.functions.devAssistant.maintainers.listMaintainers, {
        token: plainId,
      }),
    ).rejects.toThrow();
  });

  test("listMaintainers returns only granted users", async () => {
    const t = convexTest(schema, modules);
    const superId = await t.run((ctx) =>
      ctx.db.insert("users", user({ isSuperuser: true })),
    );
    const maintainerId = await t.run((ctx) =>
      ctx.db.insert(
        "users",
        user({ firstName: "Maint", platformRoles: [DEV_MAINTAINER_ROLE] }),
      ),
    );
    await t.run((ctx) =>
      ctx.db.insert("users", user({ firstName: "Other" })),
    );

    const list = await t.query(
      api.functions.devAssistant.maintainers.listMaintainers,
      { token: superId },
    );
    expect(list.map((u) => u._id)).toEqual([maintainerId]);
  });
});

// ============================================================================
// myAccess — drives the client gating
// ============================================================================

describe("myAccess", () => {
  test("reflects super admin, maintainer, and assistant access", async () => {
    const t = convexTest(schema, modules);
    const superId = await t.run((ctx) =>
      ctx.db.insert("users", user({ isSuperuser: true })),
    );
    const maintainerId = await t.run((ctx) =>
      ctx.db.insert("users", user({ platformRoles: [DEV_MAINTAINER_ROLE] })),
    );
    const plainId = await t.run((ctx) =>
      ctx.db.insert("users", user({ firstName: "Plain" })),
    );

    expect(
      await t.query(api.functions.devAssistant.maintainers.myAccess, {
        token: superId,
      }),
    ).toEqual({ isMaintainer: false, isSuperAdmin: true, canUseAssistant: true });

    expect(
      await t.query(api.functions.devAssistant.maintainers.myAccess, {
        token: maintainerId,
      }),
    ).toEqual({ isMaintainer: true, isSuperAdmin: false, canUseAssistant: true });

    expect(
      await t.query(api.functions.devAssistant.maintainers.myAccess, {
        token: plainId,
      }),
    ).toEqual({
      isMaintainer: false,
      isSuperAdmin: false,
      canUseAssistant: false,
    });
  });
});
