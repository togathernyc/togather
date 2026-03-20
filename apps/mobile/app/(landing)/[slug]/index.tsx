/**
 * Redirect /[slug] to /c/[slug] for community landing pages
 *
 * When users open links like https://fount.togather.nyc/fount (subdomain as path),
 * redirect to the canonical community landing route /c/fount.
 */
import { Redirect, useLocalSearchParams } from "expo-router";

export default function SlugRedirect() {
  const { slug } = useLocalSearchParams<{ slug: string }>();

  if (typeof slug === "string" && slug.length > 0) {
    return <Redirect href={`/c/${slug}`} />;
  }

  return <Redirect href="/(tabs)/search" />;
}
