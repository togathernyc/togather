/**
 * Upload Functions Tests
 *
 * Tests for Convex storage upload functions (generateUploadUrl, confirmUpload,
 * getFileUrl, deleteFile, getMediaUrl).
 *
 * Run with: cd convex && pnpm test __tests__/uploads.test.ts
 */

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../test.setup";
import { generateTokens } from "../lib/auth";

// ============================================================================
// Test Helpers
// ============================================================================

async function seedUser(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      phone: "+11234567890",
      firstName: "Test",
      lastName: "User",
      phoneVerified: true,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
}

async function getTokenForUser(userId: string) {
  const { accessToken } = await generateTokens(userId);
  return accessToken;
}

// ============================================================================
// generateUploadUrl Tests
// ============================================================================

describe("generateUploadUrl", () => {
  test("returns a valid upload URL for authenticated user", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const token = await getTokenForUser(userId);

    const url = await t.mutation(api.functions.uploads.generateUploadUrl, {
      token,
    });

    expect(url).toBeTruthy();
    expect(typeof url).toBe("string");
  });

  test("rejects unauthenticated requests", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(api.functions.uploads.generateUploadUrl, {
        token: "invalid-token",
      })
    ).rejects.toThrow();
  });
});

// ============================================================================
// confirmUpload Tests
// ============================================================================

describe("confirmUpload", () => {
  test("returns success with URL for valid storage ID", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const token = await getTokenForUser(userId);

    // Upload a file to get a real storage ID
    const uploadUrl = await t.mutation(api.functions.uploads.generateUploadUrl, {
      token,
    });

    // Simulate uploading to the URL (convex-test provides storage mock)
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(["test content"]));
    });

    const result = await t.mutation(api.functions.uploads.confirmUpload, {
      token,
      storageId,
    });

    expect(result.success).toBe(true);
    expect(result.storageId).toBe(storageId);
    expect(result.url).toBeTruthy();
    expect(typeof result.url).toBe("string");
  });

  test("throws error for non-existent storage ID", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const token = await getTokenForUser(userId);

    // Use a fake storage ID that won't resolve to a URL
    // convex-test's storage.getUrl returns null for unknown IDs
    const fakeStorageId = await t.run(async (ctx) => {
      // Store and then delete to get a valid-format ID that won't have a URL
      const id = await ctx.storage.store(new Blob(["temp"]));
      await ctx.storage.delete(id);
      return id;
    });

    await expect(
      t.mutation(api.functions.uploads.confirmUpload, {
        token,
        storageId: fakeStorageId,
      })
    ).rejects.toThrow("[confirmUpload] Failed to retrieve URL");
  });

  test("rejects unauthenticated requests", async () => {
    const t = convexTest(schema, modules);

    // Store a file to get valid storageId
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(["test"]));
    });

    await expect(
      t.mutation(api.functions.uploads.confirmUpload, {
        token: "invalid-token",
        storageId,
      })
    ).rejects.toThrow();
  });

  test("accepts optional entity parameters without error", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const token = await getTokenForUser(userId);

    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(["test content"]));
    });

    // Entity params are accepted but currently no-op (TODO in source)
    const result = await t.mutation(api.functions.uploads.confirmUpload, {
      token,
      storageId,
      entityType: "user",
      entityId: userId,
      folder: "profiles",
    });

    expect(result.success).toBe(true);
    expect(result.url).toBeTruthy();
  });
});

// ============================================================================
// getFileUrl Tests
// ============================================================================

describe("getFileUrl", () => {
  test("returns URL for existing storage ID", async () => {
    const t = convexTest(schema, modules);

    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(["file content"]));
    });

    const url = await t.query(api.functions.uploads.getFileUrl, {
      storageId,
    });

    expect(url).toBeTruthy();
    expect(typeof url).toBe("string");
  });

  test("returns null for deleted storage ID", async () => {
    const t = convexTest(schema, modules);

    const storageId = await t.run(async (ctx) => {
      const id = await ctx.storage.store(new Blob(["temp"]));
      await ctx.storage.delete(id);
      return id;
    });

    const url = await t.query(api.functions.uploads.getFileUrl, {
      storageId,
    });

    expect(url).toBeNull();
  });
});

// ============================================================================
// deleteFile Tests
// ============================================================================

describe("deleteFile", () => {
  test("deletes a stored file successfully", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const token = await getTokenForUser(userId);

    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(["file to delete"]));
    });

    // Verify file exists first
    const urlBefore = await t.query(api.functions.uploads.getFileUrl, {
      storageId,
    });
    expect(urlBefore).toBeTruthy();

    // Delete it
    const result = await t.mutation(api.functions.uploads.deleteFile, {
      token,
      storageId,
    });
    expect(result.success).toBe(true);

    // Verify file is gone
    const urlAfter = await t.query(api.functions.uploads.getFileUrl, {
      storageId,
    });
    expect(urlAfter).toBeNull();
  });

  test("rejects unauthenticated delete requests", async () => {
    const t = convexTest(schema, modules);

    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(["protected file"]));
    });

    await expect(
      t.mutation(api.functions.uploads.deleteFile, {
        token: "invalid-token",
        storageId,
      })
    ).rejects.toThrow();
  });
});

// ============================================================================
// getMediaUrl Tests
// ============================================================================

describe("getMediaUrl", () => {
  test("returns null for undefined path", async () => {
    const t = convexTest(schema, modules);

    const url = await t.query(api.functions.uploads.getMediaUrl, {});
    expect(url).toBeNull();
  });

  test("returns full URL as-is for http URLs", async () => {
    const t = convexTest(schema, modules);

    const httpUrl = "http://example.com/image.jpg";
    const url = await t.query(api.functions.uploads.getMediaUrl, {
      path: httpUrl,
    });
    expect(url).toBe(httpUrl);
  });

  test("returns full URL as-is for https URLs", async () => {
    const t = convexTest(schema, modules);

    const httpsUrl = "https://cdn.example.com/uploads/photo.png";
    const url = await t.query(api.functions.uploads.getMediaUrl, {
      path: httpsUrl,
    });
    expect(url).toBe(httpsUrl);
  });

  test("returns null for unrecognized path format", async () => {
    const t = convexTest(schema, modules);

    const url = await t.query(api.functions.uploads.getMediaUrl, {
      path: "some/random/path",
    });
    expect(url).toBeNull();
  });
});
