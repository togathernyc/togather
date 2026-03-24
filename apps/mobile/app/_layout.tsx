// Polyfill URL.canParse for older browsers and environments
if (typeof URL !== 'undefined' && !URL.canParse) {
  URL.canParse = function (url: string, base?: string) {
    try {
      new URL(url, base);
      return true;
    } catch {
      return false;
    }
  };
}

import React, { useMemo, useEffect, useState } from "react";
import { Platform, View, ActivityIndicator, StyleSheet } from "react-native";
import { Stack, useSegments } from "expo-router";
import * as Font from "expo-font";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
// Note: KeyboardProvider from react-native-keyboard-controller was causing conflicts
// with Stream Chat's overlay system during interactive keyboard dismiss
import { AuthProvider } from "@providers/AuthProvider";
import { EnvironmentProvider, useEnvironment } from "@providers/EnvironmentProvider";
import { ImageViewerProvider } from "@providers/ImageViewerProvider";
import { NotificationProvider } from "@providers/NotificationProvider";
import { PostHogProvider } from "@providers/PostHogProvider";
import { SentryProvider } from "@providers/SentryProvider";
import { ThemeProvider } from "@providers/ThemeProvider";
import { useTheme } from "@hooks/useTheme";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "@components/ErrorBoundary";
import { TestFlightBanner } from "@components/ui/TestFlightBanner";
import { StatusBar as BottomStatusBar, useStatusBarVisible, STATUS_BAR_CONTENT_HEIGHT } from "@components/ui/StatusBar";
import { ConnectionProvider } from "@providers/ConnectionProvider";
import { NativeUpdateModal } from "@components/ui/NativeUpdateModal";
import { OTAUpdateModal } from "@components/ui/OTAUpdateModal";
import { OTAUpdateProvider } from "@providers/OTAUpdateProvider";
import { BirthdayCollectionModal } from "@components/legal/BirthdayCollectionModal";
import { initializeMobileApiClient } from "@services/api/init";
import { ConvexProvider, useTokenSync } from "@services/api/convex";
import { logCollector } from "@utils/logCollector";
import { ChatPrefetchProvider } from "@features/chat/context/ChatPrefetchContext";
import { usePrefetchExecutor } from "@features/chat/hooks/usePrefetchChannel";
// Initialize log collector to capture console output for debugging
logCollector.initialize();

// Ensure (tabs) is always the base route so deep-linked modals present
// over the tab bar instead of filling the entire screen on cold start.
export const unstable_settings = {
  initialRouteName: "(tabs)",
};

/**
 * Component that registers the prefetch executor.
 * Must be inside ChatPrefetchProvider and AuthProvider.
 */
function PrefetchExecutorRegistration({ children }: { children: React.ReactNode }) {
  usePrefetchExecutor();
  return <>{children}</>;
}

/**
 * StatusBar that respects the app's theme preference (not just system).
 */
function ThemedStatusBar() {
  const { isDark } = useTheme();
  return <StatusBar style={isDark ? "light" : "dark"} />;
}

/**
 * Stack navigator with theme-aware content styles.
 */
function ThemedStack() {
  const { colors } = useTheme();

  return (
    <Stack
      initialRouteName="(tabs)"
      screenOptions={{
        headerShown: false,
        animation: "fade",
        animationTypeForReplace: "push",
        gestureEnabled: false,
        presentation: "card",
        contentStyle: {
          backgroundColor: colors.background,
        },
      }}
    >
      <Stack.Screen
        name="(user)"
        options={{
          presentation: "modal",
          animation: "slide_from_bottom",
          gestureEnabled: true,
        }}
      />
      <Stack.Screen
        name="groups"
        options={{
          presentation: "modal",
          animation: "slide_from_bottom",
          gestureEnabled: true,
        }}
      />
      <Stack.Screen
        name="e"
        options={{
          presentation: "modal",
          animation: "slide_from_right",
          gestureEnabled: true,
        }}
      />
      {/* Public universal-link landings: modal at root so swipe-to-dismiss works (nested stack options are not enough) */}
      <Stack.Screen
        name="(landing)"
        options={{
          presentation: "modal",
          animation: "slide_from_bottom",
          gestureEnabled: true,
        }}
      />
      <Stack.Screen
        name="c"
        options={{
          presentation: "modal",
          animation: "slide_from_bottom",
          gestureEnabled: true,
        }}
      />
      {/* Inbox routes - slide from right like iMessage/WhatsApp */}
      <Stack.Screen
        name="inbox"
        options={{
          animation: "slide_from_right",
          gestureEnabled: true,
        }}
      />
    </Stack>
  );
}

/**
 * Container that adds bottom safe area padding + extra space for the
 * status bar banner when it's visible. This keeps ALL screens (tabs,
 * chat, modals) above the banner without per-screen fixes.
 */
function StatusBarAwareContainer({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const isStatusBarVisible = useStatusBarVisible();
  const segments = useSegments();
  const { colors } = useTheme();

  // Landing page needs edge-to-edge design with dark background
  const segmentArray = segments as string[];
  const isLandingPage = segmentArray.includes("landing") || (segmentArray[0] === "(auth)" && segmentArray[1] === "landing");

  // Keep padding consistent to prevent jank
  const bottomPadding = insets.bottom + (isStatusBarVisible ? STATUS_BAR_CONTENT_HEIGHT : 0);

  return (
    <>
      {/* Background layer for landing page - matches image bottom fade */}
      {isLandingPage && (
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.landing }]} />
      )}
      <View style={{ flex: 1, backgroundColor: isLandingPage ? "transparent" : colors.background, paddingBottom: bottomPadding }}>
        {children}
      </View>
      <BottomStatusBar />
    </>
  );
}

/**
 * Inner layout that renders after environment is loaded.
 * Creates API clients with the correct environment configuration.
 */
function AppLayout() {
  const { config } = useEnvironment();

  // Initialize token sync to keep cachedToken in sync with AsyncStorage
  // This is required for useStoredAuthToken() to work properly during login
  useTokenSync();

  // Create API clients using the current environment configuration
  // Environment is determined at build time (staging vs production builds)
  const queryClient = useMemo(() => {
    // Initialize API client with current environment
    initializeMobileApiClient();

    return new QueryClient({
      defaultOptions: {
        queries: {
          retry: 1,
          staleTime: 30 * 1000,
        },
      },
    });
  }, [config.name]);

  return (
    <ConvexProvider>
      <ConnectionProvider>
        <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <PostHogProvider>
            <NotificationProvider>
              <ImageViewerProvider>
              <ChatPrefetchProvider>
                <PrefetchExecutorRegistration>
                  <StatusBarAwareContainer>
                    <NativeUpdateModal />
                    <OTAUpdateModal />
                    <BirthdayCollectionModal />
                    <TestFlightBanner />
                    <ThemedStack />
                  </StatusBarAwareContainer>
                </PrefetchExecutorRegistration>
              </ChatPrefetchProvider>
              </ImageViewerProvider>
            </NotificationProvider>
          </PostHogProvider>
        </AuthProvider>
        </QueryClientProvider>
      </ConnectionProvider>
    </ConvexProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded, setFontsLoaded] = useState(false);

  // Load icon fonts before rendering the app
  // This ensures @expo/vector-icons render correctly on web
  useEffect(() => {
    async function loadFonts() {
      try {
        // Load Ionicons font which is used throughout the app
        await Font.loadAsync(Ionicons.font);
        setFontsLoaded(true);
      } catch (error) {
        // If font loading fails, still render the app
        // Icons may not show but app remains functional
        console.warn("Failed to load icon fonts:", error);
        setFontsLoaded(true);
      }
    }
    loadFonts();
  }, []);

  // Show loading indicator while fonts are loading (web only needs this)
  if (!fontsLoaded && Platform.OS === "web") {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: '#fff' }}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SentryProvider>
        <ErrorBoundary>
          <SafeAreaProvider>
            <ThemeProvider>
              <ThemedStatusBar />
              <OTAUpdateProvider>
                <EnvironmentProvider>
                  <AppLayout />
                </EnvironmentProvider>
              </OTAUpdateProvider>
            </ThemeProvider>
          </SafeAreaProvider>
        </ErrorBoundary>
      </SentryProvider>
    </GestureHandlerRootView>
  );
}
