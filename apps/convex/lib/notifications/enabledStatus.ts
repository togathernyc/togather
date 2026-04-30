/**
 * Per-user "is push enabled" lookups for client-facing UI.
 *
 * Truth table (matches `tokens.getActiveTokensForUser` and the running
 * `notificationEnabledCounter`): a user has notifications enabled iff at
 * least one row exists in `pushTokens` for `(userId, current environment)`.
 *
 * UI surfaces use the inverse — `notificationsDisabled: boolean` — because
 * "disabled" is the state we render an indicator for.
 */

import type { QueryCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { getCurrentEnvironment } from "./send";

/**
 * Returns true when the user has no push tokens for the current environment.
 */
export async function isUserNotificationsDisabled(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<boolean> {
  const environment = getCurrentEnvironment();
  const token = await ctx.db
    .query("pushTokens")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .filter((q) => q.eq(q.field("environment"), environment))
    .first();
  return token === null;
}

/**
 * Batched form for list/search queries — issues one parallel pushTokens
 * lookup per unique user ID and returns the set of users with notifications
 * disabled. Pass the resulting set to `notifsDisabledForUser(disabled, id)`.
 */
export async function getUsersWithNotificationsDisabled(
  ctx: QueryCtx,
  userIds: ReadonlyArray<Id<"users">>,
): Promise<Set<Id<"users">>> {
  if (userIds.length === 0) return new Set();
  const environment = getCurrentEnvironment();
  const unique = Array.from(new Set(userIds));
  const tokens = await Promise.all(
    unique.map((userId) =>
      ctx.db
        .query("pushTokens")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .filter((q) => q.eq(q.field("environment"), environment))
        .first(),
    ),
  );
  const disabled = new Set<Id<"users">>();
  unique.forEach((userId, i) => {
    if (tokens[i] === null) disabled.add(userId);
  });
  return disabled;
}

export function notifsDisabledForUser(
  disabled: Set<Id<"users">>,
  userId: Id<"users">,
): boolean {
  return disabled.has(userId);
}
