/**
 * DmFeatureGate
 *
 * Wraps screens that exist only when the `direct-messages` feature flag is
 * on. Routes stay registered (so deep links don't 404) but the body shows a
 * placeholder when the flag is off rather than rendering the feature.
 *
 * The flag is a row in the Convex `featureFlags` table flipped from
 * `/(user)/admin/features`. Renders a lightweight spinner while the query
 * hydrates so rollout-cohort users don't see the disabled UI on cold start.
 */
import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useConvexFeatureFlag } from "@hooks/useConvexFeatureFlag";

interface DmFeatureGateProps {
  children: React.ReactNode;
}

export function DmFeatureGate({ children }: DmFeatureGateProps) {
  const { enabled, loaded } = useConvexFeatureFlag("direct-messages");
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();

  if (enabled) {
    return <>{children}</>;
  }

  // Render a spinner — not the disabled placeholder — while the flag value
  // is still hydrating from AsyncStorage / PostHog. Otherwise rollout-cohort
  // users briefly see "Direct messages aren't available yet" on cold starts
  // and could navigate away before the flag resolves to enabled.
  if (!loaded) {
    return (
      <View
        style={[
          styles.container,
          styles.loading,
          { backgroundColor: colors.surface },
        ]}
      >
        <ActivityIndicator size="small" color={primaryColor} />
      </View>
    );
  }

  const handleClose = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/chat");
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 16,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          onPress={handleClose}
          style={styles.headerSide}
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={26} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerSide} />
      </View>
      <View style={styles.body}>
        <Ionicons
          name="chatbubbles-outline"
          size={56}
          color={colors.iconSecondary}
          style={styles.icon}
        />
        <Text style={[styles.title, { color: colors.text }]}>
          Direct messages aren't available yet
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Check back soon — we're rolling this out gradually.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loading: {
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerSide: {
    width: 40,
    height: 32,
    justifyContent: "center",
  },
  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  icon: {
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 8,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 15,
    textAlign: "center",
    maxWidth: 320,
  },
});
