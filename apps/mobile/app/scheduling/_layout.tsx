import { Stack } from "expo-router";

/**
 * Scheduling deep-link stack.
 *
 * Hosts `/scheduling/assignment/[id]` — the target of the push/SMS
 * assignment-request links sent by `scheduling.publishEvent`. Lives at the
 * app root (not under `(user)`) so a cold-start deep link resolves
 * directly; `UserRoute`-style auth is enforced by the screen's
 * authenticated Convex queries.
 */
export default function SchedulingLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
