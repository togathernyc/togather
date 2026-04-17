/**
 * Posters — global curated event cover library.
 *
 * Curated by platform-level poster_admins. Global-only: every community sees
 * the same library. See ADR-023 (poster library).
 *
 * Access model:
 * - isSuperuser || isStaff → implicit access (can do anything a poster_admin can,
 *   plus grant/revoke poster_admin to others).
 * - platformRoles.includes("poster_admin") → can upload/edit/remove posters.
 *
 * Keyword generation uses the existing OpenAI integration (OPENAI_SECRET_KEY).
 */

import { v, ConvexError } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  query,
  mutation,
  action,
} from "../_generated/server";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { api } from "../_generated/api";
import {
  requireAuth,
  requireAuthUser,
  requireAuthFromTokenAction,
} from "../lib/auth";
import { now } from "../lib/utils";

export const POSTER_ADMIN_ROLE = "poster_admin" as const;

// ============================================================================
// Access helpers
// ============================================================================

/**
 * True if user has the given platform role, or bypasses via isSuperuser/isStaff.
 */
export function hasPlatformRole(
  user: Doc<"users"> | null | undefined,
  role: string,
): boolean {
  if (!user) return false;
  if (user.isSuperuser === true || user.isStaff === true) return true;
  return user.platformRoles?.includes(role) ?? false;
}

/** True if user can manage (grant/revoke) platform roles. Superuser/staff only. */
export function isPlatformSuperAdmin(
  user: Doc<"users"> | null | undefined,
): boolean {
  return user?.isSuperuser === true || user?.isStaff === true;
}

async function requirePosterAdmin(
  ctx: QueryCtx | MutationCtx,
  token: string,
): Promise<Doc<"users">> {
  const user = await requireAuthUser(ctx, token);
  if (!hasPlatformRole(user, POSTER_ADMIN_ROLE)) {
    throw new ConvexError("Not authorized: poster_admin role required");
  }
  return user;
}

async function requireSuperAdmin(
  ctx: QueryCtx | MutationCtx,
  token: string,
): Promise<Doc<"users">> {
  const user = await requireAuthUser(ctx, token);
  if (!isPlatformSuperAdmin(user)) {
    throw new ConvexError("Not authorized: superuser required");
  }
  return user;
}

// ============================================================================
// Queries
// ============================================================================

/**
 * Current user's permissions re: posters. Used by the client to decide
 * whether to show the admin/posters nav entry and the "Manage access" panel.
 */
export const myAccess = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const user = await ctx.db.get(userId);
    return {
      isPosterAdmin: hasPlatformRole(user, POSTER_ADMIN_ROLE),
      isSuperAdmin: isPlatformSuperAdmin(user),
    };
  },
});

/**
 * Paginated list of active posters, newest first. Used by the event-create
 * picker and the admin grid.
 */
export const list = query({
  args: {
    token: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx, args.token);
    return await ctx.db
      .query("posters")
      .withIndex("by_active_createdAt", (q) => q.eq("active", true))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

/**
 * Full-text search across poster keywords. Empty query returns the most
 * recent active posters (falls back to list).
 */
export const search = query({
  args: {
    token: v.string(),
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx, args.token);
    const limit = Math.min(args.limit ?? 60, 200);
    const trimmed = args.query.trim();
    if (!trimmed) {
      return await ctx.db
        .query("posters")
        .withIndex("by_active_createdAt", (q) => q.eq("active", true))
        .order("desc")
        .take(limit);
    }
    return await ctx.db
      .query("posters")
      .withSearchIndex("search_posters", (q) =>
        q.search("searchText", trimmed).eq("active", true),
      )
      .take(limit);
  },
});

export const getById = query({
  args: { token: v.string(), posterId: v.id("posters") },
  handler: async (ctx, args) => {
    await requireAuth(ctx, args.token);
    return await ctx.db.get(args.posterId);
  },
});

/**
 * List of users currently holding poster_admin. Superuser-only (used by the
 * Manage access panel).
 */
export const listPosterAdmins = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx, args.token);
    // No index on platformRoles array membership — scan is acceptable given
    // this list is small and the page is operator-only.
    const users = await ctx.db.query("users").collect();
    return users
      .filter((u) => u.platformRoles?.includes(POSTER_ADMIN_ROLE))
      .map((u) => ({
        _id: u._id,
        firstName: u.firstName ?? null,
        lastName: u.lastName ?? null,
        email: u.email ?? null,
        phone: u.phone ?? null,
        profilePhoto: u.profilePhoto ?? null,
        isSuperuser: u.isSuperuser === true,
      }));
  },
});

/**
 * Superuser-only user search for the "Grant poster_admin" picker.
 * Matches against the denormalized users.searchText index.
 */
export const searchUsersForGrant = query({
  args: { token: v.string(), query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx, args.token);
    const limit = Math.min(args.limit ?? 10, 50);
    const trimmed = args.query.trim();
    if (trimmed.length < 2) return [];
    const users = await ctx.db
      .query("users")
      .withSearchIndex("search_users", (q) => q.search("searchText", trimmed))
      .take(limit);
    return users.map((u) => ({
      _id: u._id,
      firstName: u.firstName ?? null,
      lastName: u.lastName ?? null,
      email: u.email ?? null,
      phone: u.phone ?? null,
      profilePhoto: u.profilePhoto ?? null,
      alreadyPosterAdmin: hasPlatformRole(u, POSTER_ADMIN_ROLE),
    }));
  },
});

// ============================================================================
// Mutations — poster CRUD
// ============================================================================

function buildSearchText(keywords: string[]): string {
  return keywords
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 0)
    .join(" ");
}

function normalizeKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of keywords) {
    const k = raw.trim().toLowerCase();
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

export const create = mutation({
  args: {
    token: v.string(),
    imageUrl: v.string(),
    imageStorageKey: v.optional(v.string()),
    keywords: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"posters">> => {
    const user = await requirePosterAdmin(ctx, args.token);
    const keywords = normalizeKeywords(args.keywords);
    const ts = now();
    return await ctx.db.insert("posters", {
      imageUrl: args.imageUrl,
      imageStorageKey: args.imageStorageKey,
      keywords,
      searchText: buildSearchText(keywords),
      uploadedById: user._id,
      active: true,
      createdAt: ts,
      updatedAt: ts,
    });
  },
});

export const update = mutation({
  args: {
    token: v.string(),
    posterId: v.id("posters"),
    keywords: v.optional(v.array(v.string())),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requirePosterAdmin(ctx, args.token);
    const existing = await ctx.db.get(args.posterId);
    if (!existing) throw new ConvexError("Poster not found");
    const patch: Partial<Doc<"posters">> = { updatedAt: now() };
    if (args.keywords) {
      const keywords = normalizeKeywords(args.keywords);
      patch.keywords = keywords;
      patch.searchText = buildSearchText(keywords);
    }
    if (typeof args.active === "boolean") {
      patch.active = args.active;
    }
    await ctx.db.patch(args.posterId, patch);
  },
});

/** Soft delete — sets active:false. Keeps the row so events referencing posterId still resolve. */
export const remove = mutation({
  args: { token: v.string(), posterId: v.id("posters") },
  handler: async (ctx, args) => {
    await requirePosterAdmin(ctx, args.token);
    const existing = await ctx.db.get(args.posterId);
    if (!existing) return;
    await ctx.db.patch(args.posterId, { active: false, updatedAt: now() });
  },
});

// ============================================================================
// Mutations — role grants (superuser-only)
// ============================================================================

export const grantPosterAdmin = mutation({
  args: { token: v.string(), userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx, args.token);
    const target = await ctx.db.get(args.userId);
    if (!target) throw new ConvexError("User not found");
    const current = target.platformRoles ?? [];
    if (current.includes(POSTER_ADMIN_ROLE)) return;
    await ctx.db.patch(args.userId, {
      platformRoles: [...current, POSTER_ADMIN_ROLE],
    });
  },
});

export const revokePosterAdmin = mutation({
  args: { token: v.string(), userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx, args.token);
    const target = await ctx.db.get(args.userId);
    if (!target) throw new ConvexError("User not found");
    const current = target.platformRoles ?? [];
    const next = current.filter((r) => r !== POSTER_ADMIN_ROLE);
    await ctx.db.patch(args.userId, { platformRoles: next });
  },
});

// ============================================================================
// AI keyword generation
// ============================================================================

const KEYWORD_SYSTEM_PROMPT = `You are tagging event cover posters for a community events platform similar to Partiful.

Given a poster image, return 5-10 lowercase keywords that capture:
- The vibe/mood (e.g. "elegant", "playful", "minimal", "retro", "cozy")
- The event type if implied (e.g. "birthday", "dinner party", "watch party", "wedding shower", "housewarming")
- Dominant visual elements or motifs (e.g. "balloons", "confetti", "champagne", "flowers", "neon")
- Color palette cues if distinctive (e.g. "pastel", "rainbow", "monochrome", "warm tones")

Rules:
- Only factual, search-useful tags. No names, no brand names, no event dates.
- Prefer short single words or two-word phrases.
- Return strictly JSON in the shape {"keywords": ["a", "b", ...]}. No prose, no markdown.`;

/**
 * Generate keywords for a poster image via OpenAI vision (gpt-4o-mini).
 * Called from the admin upload flow after the image is uploaded to R2.
 * Admin reviews/edits the returned keywords before calling `create`.
 */
export const generateKeywords = action({
  args: { token: v.string(), imageUrl: v.string() },
  handler: async (ctx, args): Promise<{ keywords: string[] }> => {
    // Auth — must be a poster admin (or superuser). Check via query.
    await requireAuthFromTokenAction(ctx, args.token);
    const access = await ctx.runQuery(api.functions.posters.myAccess, {
      token: args.token,
    });
    if (!access.isPosterAdmin) {
      throw new ConvexError("Not authorized: poster_admin role required");
    }

    const openaiKey = process.env.OPENAI_SECRET_KEY;
    if (!openaiKey) {
      throw new ConvexError("OPENAI_SECRET_KEY not configured");
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: KEYWORD_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Generate keywords for this poster.",
              },
              {
                type: "image_url",
                image_url: { url: args.imageUrl },
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new ConvexError(
        `OpenAI error ${response.status}: ${body.slice(0, 300)}`,
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) {
      return { keywords: [] };
    }

    let parsed: { keywords?: unknown };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { keywords: [] };
    }
    const kws = Array.isArray(parsed.keywords) ? parsed.keywords : [];
    const cleaned = normalizeKeywords(
      kws.filter((k): k is string => typeof k === "string"),
    );
    return { keywords: cleaned };
  },
});
