/* eslint-disable react-refresh/only-export-components -- entry-point file, not a hot-refreshed module */
/**
 * DEMO (proof-of-concept): render the REAL mobile-app `CommunitySelector`
 * component on the web with fake data and no backend.
 *
 * This bundle is built as a separate Vite page and embedded into a guide via an
 * <iframe>. It proves the pipeline: real React Native screen code → rendered on
 * the web via react-native-web → wrapped in the app's real ThemeProvider →
 * fed mock data. Native storage is stubbed (see vite.config alias); no Convex,
 * auth, or router is needed for this screen.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { View, Text } from "react-native";
// Real app code:
import { ThemeProvider } from "../../mobile/providers/ThemeProvider";
import { useTheme } from "../../mobile/hooks/useTheme";
import { CommunitySelector } from "../../mobile/features/auth/components/CommunitySelector";

// Fake data — what a real `useQuery(api.functions.users.me)` would return.
const fakeCommunities = [
  { name: "Grace Park Church", subdomain: "grace-park" },
  { name: "Riverside Community", subdomain: "riverside" },
  { name: "Hope City", subdomain: "hope-city" },
];

function DemoScreen() {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, padding: 16 }}>
      <Text
        style={{
          fontSize: 13,
          fontWeight: "600",
          color: colors.textTertiary,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          marginBottom: 12,
        }}
      >
        Your Communities
      </Text>
      {fakeCommunities.map((community) => (
        <CommunitySelector
          key={community.subdomain}
          community={community as never}
          onChange={() => {}}
        />
      ))}
    </View>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <DemoScreen />
    </ThemeProvider>
  </StrictMode>,
);
