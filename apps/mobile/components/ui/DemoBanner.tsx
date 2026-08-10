/**
 * App-wide banner shown while the active community is a demo (communities
 * created via /onboarding/demo start in demo mode). Rendered in the root
 * layout after the navigation stack, so it sits as a persistent strip at the
 * bottom of every screen without disturbing per-screen safe-area layouts.
 *
 * Admins get a "Go live" affordance that opens the conversion screen
 * (/onboarding/go-live); everyone else sees a plain "demo" notice.
 */
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useRouter, usePathname } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@providers/AuthProvider";
import { useAuthenticatedQuery, api, Id } from "@services/api/convex";
import { useCommunityTheme } from "@hooks/useCommunityTheme";

/**
 * Routes where the "you're in a demo, go live" strip is redundant or wrong:
 * the go-live screen (they're already converting) and the community switcher
 * (they're between communities, not inside the demo).
 */
const HIDDEN_ON_ROUTES = ["/onboarding/go-live", "/select-community"];

export function DemoBanner() {
  const router = useRouter();
  const pathname = usePathname();
  const { community, isAuthenticated } = useAuth();
  const { primaryColor } = useCommunityTheme();

  const status = useAuthenticatedQuery(
    api.functions.demo.getDemoStatus,
    isAuthenticated && community?.id
      ? { communityId: community.id as Id<"communities"> }
      : "skip",
  );

  if (HIDDEN_ON_ROUTES.some((route) => pathname?.startsWith(route))) {
    return null;
  }

  if (!status?.isDemo) {
    return null;
  }

  const content = (
    <View style={[styles.banner, { backgroundColor: primaryColor }]}>
      <Ionicons name="flask-outline" size={14} color="#FFFFFF" />
      <Text style={styles.text} numberOfLines={1}>
        You're exploring a demo of {community?.name ?? "your community"}
      </Text>
      {status.isAdmin && (
        <View style={styles.cta}>
          <Text style={styles.ctaText}>Go live</Text>
          <Ionicons name="chevron-forward" size={13} color="#FFFFFF" />
        </View>
      )}
    </View>
  );

  if (!status.isAdmin) {
    return content;
  }

  return (
    <Pressable
      onPress={() => router.push("/onboarding/go-live")}
      accessibilityRole="button"
      accessibilityLabel="This is a demo community. Go live."
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  text: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
    flexShrink: 1,
  },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 4,
    paddingLeft: 8,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: "rgba(255,255,255,0.5)",
  },
  ctaText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
    textDecorationLine: "underline",
  },
});
