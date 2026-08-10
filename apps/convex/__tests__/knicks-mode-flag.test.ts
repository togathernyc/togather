/**
 * Tests for Knicks mode as an APP-WIDE feature flag.
 *
 * Knicks mode used to be a per-community setting (`communities.knicksMode`,
 * on by default). It now lives in the `featureFlags` table under the
 * "knicks-mode" key, flipped app-wide by staff via /admin/features, and is
 * OFF by default. `users.me` resolves the flag and surfaces it under the
 * legacy `activeCommunityKnicksMode` field name so old mobile clients (which
 * still read that field) keep working during rollout. New clients subscribe
 * to the flag live via useConvexFeatureFlag instead.
 *
 * Coverage:
 *   - Default OFF when no flag row exists.
 *   - ON when the "knicks-mode" flag is enabled.
 *   - OFF when the flag exists but is disabled.
 *
 * Run with: cd apps/convex && pnpm test __tests__/knicks-mode-flag.test.ts
 */

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../test.setup";
import { generateTokens } from "../lib/auth";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

async function createUserWithToken(t: ReturnType<typeof convexTest>) {
  const userId = await t.run(async (ctx) =>
    ctx.db.insert("users", {
      firstName: "Knick",
      lastName: "Fan",
      email: "knick.fan@example.com",
      phoneVerified: false,
    }),
  );
  const { accessToken } = await generateTokens(userId);
  return { userId, accessToken };
}

describe("Knicks mode app-wide feature flag", () => {
  test("users.me reports knicksMode=false when no flag row exists", async () => {
    const t = convexTest(schema, modules);
    const { accessToken } = await createUserWithToken(t);

    const me = (await t.query(api.functions.users.me, {
      token: accessToken,
    })) as { activeCommunityKnicksMode: boolean } | null;

    expect(me).not.toBeNull();
    expect(me!.activeCommunityKnicksMode).toBe(false);
  });

  test("users.me reports knicksMode=true when the flag is enabled", async () => {
    const t = convexTest(schema, modules);
    const { accessToken } = await createUserWithToken(t);

    await t.run(async (ctx) => {
      await ctx.db.insert("featureFlags", {
        key: "knicks-mode",
        enabled: true,
        updatedAt: Date.now(),
      });
    });

    const me = (await t.query(api.functions.users.me, {
      token: accessToken,
    })) as { activeCommunityKnicksMode: boolean } | null;

    expect(me!.activeCommunityKnicksMode).toBe(true);
  });

  test("users.me reports knicksMode=false when the flag exists but is disabled", async () => {
    const t = convexTest(schema, modules);
    const { accessToken } = await createUserWithToken(t);

    await t.run(async (ctx) => {
      await ctx.db.insert("featureFlags", {
        key: "knicks-mode",
        enabled: false,
        updatedAt: Date.now(),
      });
    });

    const me = (await t.query(api.functions.users.me, {
      token: accessToken,
    })) as { activeCommunityKnicksMode: boolean } | null;

    expect(me!.activeCommunityKnicksMode).toBe(false);
  });
});

describe("updateCommunitySettings legacy knicksMode arg (old-client compat)", () => {
  test("accepts the legacy knicksMode arg, ignores it, and still applies other updates", async () => {
    const t = convexTest(schema, modules);

    const { communityId, adminToken } = await (async () => {
      const ids = await t.run(async (ctx) => {
        const now = Date.now();
        const adminId = await ctx.db.insert("users", {
          firstName: "Admin",
          lastName: "User",
          email: "admin.knicks@example.com",
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });
        const communityId = await ctx.db.insert("communities", {
          name: "Old Name",
          slug: "knicks-compat",
          isPublic: true,
          createdAt: now,
          updatedAt: now,
        });
        await ctx.db.insert("userCommunities", {
          userId: adminId,
          communityId,
          roles: 4, // PRIMARY_ADMIN
          status: 1, // active
          createdAt: now,
          updatedAt: now,
        });
        return { adminId, communityId };
      });
      const { accessToken } = await generateTokens(ids.adminId);
      return { communityId: ids.communityId, adminToken: accessToken };
    })();

    // An old bundle's Knicks Mode switch sends knicksMode alongside a real edit.
    await expect(
      t.mutation(api.functions.admin.settings.updateCommunitySettings, {
        token: adminToken,
        communityId,
        name: "New Name",
        knicksMode: true,
      }),
    ).resolves.toBeDefined();

    const community = await t.run((ctx) => ctx.db.get(communityId));
    // The real edit applies; the legacy arg is dropped, never written.
    expect(community!.name).toBe("New Name");
    expect(community!.knicksMode).toBeUndefined();
  });
});
