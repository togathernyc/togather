/**
 * Deciding whether it is someone's birthday today.
 *
 * Togather stores two birthdays, for two different reasons:
 *
 * - `dateOfBirth` — the full date collected at sign-up for the 13+ age check.
 *   It is PII: it carries the year, and it is never returned to clients.
 * - `birthdayMonth` / `birthdayDay` — an optional month-and-day people set on
 *   their own profile, deliberately stored without a year so it is shareable.
 *
 * Either one marks a birthday, so `isBirthdayToday` reads both. Most people
 * only have the first (it is collected at sign-up), and the birthday bot
 * announces from it — so a badge driven only by the profile pair would leave
 * people celebrated in chat with nothing on their icon.
 *
 * NOTE the relationship with the bot is a **superset**, not equality:
 * `getMembersWithBirthdayToday` reads `dateOfBirth` only, so someone who set
 * just the profile month/day gets a badge and no bot post. That direction is
 * harmless. The direction that would be wrong — announced in chat with a bare
 * icon — is the one this union rules out. Matching the bot's *timezone* is what
 * keeps the two on the same calendar day.
 *
 * IMPORTANT: callers may send the resulting **boolean** to clients, and nothing
 * else. Returning the underlying date would leak the year that `dateOfBirth`
 * deliberately keeps server-side.
 */

import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { resolveTimeZone } from "./localDay";

export type BirthdayFields = {
  dateOfBirth?: number;
  birthdayMonth?: number;
  birthdayDay?: number;
};

export type MonthDay = {
  /** 1-12. */
  month: number;
  /** 1-31. */
  day: number;
};

/**
 * The month and day it is "now" in an IANA timezone.
 *
 * A missing or unrecognised zone falls back to {@link DEFAULT_TIMEZONE} via the
 * shared `resolveTimeZone`, which is the same fallback the birthday bot applies
 * to `community.timezone` (`getDueBirthdayBotConfigs`). Falling back to UTC here
 * instead would put a legacy community's badge on a different calendar day from
 * its own bot post for the last hours of the day.
 */
export function todayMonthDay(timezone?: string, nowMs?: number): MonthDay {
  const now = nowMs === undefined ? new Date() : new Date(nowMs);

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: resolveTimeZone(timezone),
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);

  return {
    month: Number(parts.find((p) => p.type === "month")?.value),
    day: Number(parts.find((p) => p.type === "day")?.value),
  };
}

/**
 * Whether it is this user's birthday on the given day, from either stored
 * birthday. `timezone` should be the community's, so this lands on the same
 * calendar day the birthday bot uses.
 */
export function isBirthdayToday(
  user: BirthdayFields,
  timezone?: string,
  nowMs?: number,
): boolean {
  const { month, day } = todayMonthDay(timezone, nowMs);

  if (user.birthdayMonth === month && user.birthdayDay === day) {
    return true;
  }

  if (user.dateOfBirth !== undefined && user.dateOfBirth !== null) {
    // `dateOfBirth` is stored as a date-only timestamp, so read it back in UTC
    // — reading it locally would shift the date for anyone born near midnight.
    const dob = new Date(user.dateOfBirth);
    if (dob.getUTCMonth() + 1 === month && dob.getUTCDate() === day) {
      return true;
    }
  }

  return false;
}

/**
 * Batched form for list queries — mirrors `getUsersWithNotificationsDisabled`.
 * Returns the set of users whose birthday it is today, so a row can ask
 * `birthdays.has(userId)` without holding any birthday data itself.
 */
export async function getUsersWithBirthdayToday(
  ctx: QueryCtx,
  userIds: ReadonlyArray<Id<"users">>,
  timezone?: string,
  /**
   * Optional memo shared across calls. A list query that calls this once per
   * row should pass one — the same person appears in several conversations,
   * and without it each appearance costs another `users` read.
   */
  cache?: Map<Id<"users">, boolean>,
): Promise<Set<Id<"users">>> {
  if (userIds.length === 0) return new Set();

  const memo = cache ?? new Map<Id<"users">, boolean>();
  const unique = Array.from(new Set(userIds));
  const unknown = unique.filter((id) => !memo.has(id));

  if (unknown.length > 0) {
    const users = await Promise.all(unknown.map((userId) => ctx.db.get(userId)));
    const nowMs = Date.now();
    unknown.forEach((userId, i) => {
      const user = users[i];
      memo.set(userId, !!user && isBirthdayToday(user, timezone, nowMs));
    });
  }

  const birthdays = new Set<Id<"users">>();
  for (const userId of unique) {
    if (memo.get(userId)) birthdays.add(userId);
  }
  return birthdays;
}
