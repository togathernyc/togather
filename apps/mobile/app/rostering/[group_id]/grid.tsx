import { Redirect, useLocalSearchParams } from "expo-router";

/**
 * Legacy `/rostering/[group_id]/grid` route.
 *
 * The grid IS the rostering home now (Stage 1), so this redirects to
 * `/rostering/[group_id]` to avoid two URLs for the same surface. Kept as a
 * redirect so existing deep links / "Open roster grid" buttons don't break.
 */
export default function RosterGridRedirect() {
  const { group_id } = useLocalSearchParams<{ group_id: string }>();
  return <Redirect href={`/rostering/${group_id}` as never} />;
}
