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
 * IMPORTANT: callers may send the resulting **boolean** to clients, and nothing
 * else. Returning the underlying date would leak the year that `dateOfBirth`
 * deliberately keeps server-side.
 */

import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

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
 * Falls back to UTC for a missing or unrecognised zone rather than throwing —
 * a bad community timezone should not take down an inbox query.
 */
export function todayMonthDay(timezone?: string, nowMs?: number): MonthDay {
  const now = nowMs === undefined ? new Date() : new Date(nowMs);

  if (timezone && timezone !== "UTC") {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        month: "numeric",
        day: "numeric",
      }).formatToParts(now);

      const month = Number(parts.find((p) => p.type === "month")?.value);
      const day = Number(parts.find((p) => p.type === "day")?.value);

      if (Number.isFinite(month) && Number.isFinite(day)) {
        return { month, day };
      }
    } catch {
      // Unrecognised timezone — fall through to UTC.
    }
  }

  return { month: now.getUTCMonth() + 1, day: now.getUTCDate() };
}

/**
 * Whether it is this user's birthday on the given day, from either stored
 * birthday. `timezone` should be the community's, so the answer matches what
 * the birthday bot announces.
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
): Promise<Set<Id<"users">>> {
  if (userIds.length === 0) return new Set();

  const unique = Array.from(new Set(userIds));
  const users = await Promise.all(unique.map((userId) => ctx.db.get(userId)));

  const nowMs = Date.now();
  const birthdays = new Set<Id<"users">>();
  unique.forEach((userId, i) => {
    const user = users[i];
    if (user && isBirthdayToday(user, timezone, nowMs)) {
      birthdays.add(userId);
    }
  });
  return birthdays;
}
