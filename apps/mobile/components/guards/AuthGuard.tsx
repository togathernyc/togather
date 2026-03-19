import { useRouter, usePathname } from "expo-router";
import { useAuth } from "@providers/AuthProvider";
import { View, ActivityIndicator, Platform } from "react-native";
import { useEffect, useState, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * AuthGuard - For public pages that redirect authenticated users
 * Equivalent to Next.js AuthRoute HOC
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const hasRedirectedRef = useRef(false);
  const redirectingRef = useRef(false);

  // Add safety timeout - force show content after 3 seconds even if loading
  const [forceShow, setForceShow] = useState(false);
  useEffect(() => {
    const safetyTimeout = setTimeout(() => {
      console.warn("🔄 [AuthGuard] Loading timeout, forcing display");
      setForceShow(true);
    }, 3000); // 3 second timeout - force show content
    return () => clearTimeout(safetyTimeout);
  }, []);

  // Handle redirect in useEffect to prevent re-render loops
  // Use primitive values in dependencies to prevent unnecessary re-runs
  const userId = user?.id ?? null;

  useEffect(() => {
    const timestamp = new Date().toISOString();
    const currentPathname = pathname;
    
    // Check for OAuth callback params in URL (on web) - don't redirect during OAuth flow
    const isOAuthCallback = Platform.OS === "web" && typeof window !== "undefined" && 
      (window.location.search.includes("code=") || window.location.search.includes("error="));
    
    console.log(`🔄 [AuthGuard] [${timestamp}] Effect triggered`, {
      currentPathname,
      isAuthenticated,
      isLoading,
      hasUser: !!user,
      userId: user?.id || null,
      hasRedirected: hasRedirectedRef.current,
      redirecting: redirectingRef.current,
      isOAuthCallback,
    });

    // CRITICAL: Check hasRedirected FIRST before any other logic
    if (hasRedirectedRef.current) {
      console.log(`🔄 [AuthGuard] [${timestamp}] Already redirected, skipping`);
      return;
    }

    // Don't redirect if we're already on the target page (tabs layout)
    const isOnTargetPage =
      currentPathname.startsWith("/(tabs)") || currentPathname === "/chat";

    if (isOnTargetPage) {
      console.log(`🔄 [AuthGuard] [${timestamp}] Already on target page, marking as redirected`);
      hasRedirectedRef.current = true;
      return;
    }

    // Prevent multiple redirects
    if (redirectingRef.current) {
      console.log(`🔄 [AuthGuard] [${timestamp}] Already redirecting, skipping`);
      return;
    }

    // Don't redirect during OAuth callback - let the OAuth flow complete first
    if (isOAuthCallback) {
      console.log(`🔄 [AuthGuard] [${timestamp}] OAuth callback detected, waiting for flow to complete`);
      return;
    }

    // If authenticated and not on target page, redirect
    // CRITICAL: Only redirect if isLoading is false - this ensures auth state is fully loaded
    if (!isLoading && isAuthenticated && user && !isOnTargetPage) {
      redirectingRef.current = true;
      hasRedirectedRef.current = true; // Set BEFORE redirect to prevent loops

      // Check for pending join intent - redirect to join-flow instead of chat if present
      (async () => {
        let targetPath = "/(tabs)/chat";
        try {
          const intent = await AsyncStorage.getItem("pending_join_intent");
          if (intent) {
            const parsed = JSON.parse(intent);
            // Check if not expired (30 min)
            if (Date.now() - parsed.timestamp < 30 * 60 * 1000) {
              targetPath = "/(auth)/join-flow";
              console.log(`🔄 [AuthGuard] [${timestamp}] Found pending join intent, redirecting to join-flow`);
            } else {
              // Clear expired intent
              await AsyncStorage.removeItem("pending_join_intent");
            }
          }
        } catch (e) {
          console.error("Error checking join intent in AuthGuard:", e);
        }

        console.log(`🔄 [AuthGuard] [${timestamp}] Redirecting authenticated user to ${targetPath}`, {
          isLoading,
          isAuthenticated,
          userId: user.id,
          currentPath: currentPathname,
        });

        // Use setTimeout to defer redirect to next event loop tick
        // This prevents the redirect from causing an immediate re-render loop
        setTimeout(() => {
          try {
            console.log(`🧭 [Navigation] [${timestamp}] Executing redirect from AuthGuard`, {
              from: currentPathname,
              to: targetPath,
              platform: Platform.OS,
            });
            // On web, use window.location.href to avoid router re-render loops
            // On native, use router.replace
            if (Platform.OS === "web") {
              window.location.href = targetPath;
            } else {
              router.replace(targetPath);
            }
          } catch (error) {
            console.error(`🔄 [AuthGuard] [${timestamp}] Redirect error:`, error);
            hasRedirectedRef.current = false; // Reset on error so we can retry
          } finally {
            redirectingRef.current = false;
          }
        }, 50); // Small delay to prevent immediate re-render loop
      })();

      return;
    } else {
      console.log(`🔄 [AuthGuard] [${timestamp}] No redirect needed`, {
        isLoading,
        isAuthenticated,
        hasUser: !!user,
        isOnTargetPage,
        isOAuthCallback,
      });
    }
    // Use primitive values in dependencies instead of objects to prevent unnecessary re-runs
    // Do NOT include pathname in dependencies - check it inside the effect instead
    // This prevents the effect from re-running when pathname changes after redirect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, isAuthenticated, userId]);

  // Always render children to preserve focus/mount state (prevents TextInput
  // focus loss on web when isLoading toggles). Overlay a spinner when loading.
  const showSpinner = isLoading && !forceShow;

  return (
    <View style={{ flex: 1 }}>
      {children}
      {showSpinner && (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: "rgba(255,255,255,0.85)",
            zIndex: 999,
          }}
        >
          <ActivityIndicator size="large" />
        </View>
      )}
    </View>
  );
}
