import { useRouter, usePathname } from "expo-router";
import { useAuth } from "@providers/AuthProvider";
import { View, ActivityIndicator, Platform } from "react-native";
import { useEffect, useRef } from "react";

/**
 * UserRoute - For user pages that require authentication
 * Equivalent to Next.js UserRoute HOC
 */
export function UserRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const hasRedirectedRef = useRef(false);
  const redirectingRef = useRef(false);

  useEffect(() => {
    // Get current pathname inside effect to check without adding to dependencies
    const currentPathname = pathname;

    // CRITICAL: UserRoute is only for (user) routes. If we're not on a (user) route,
    // don't do anything - let the index page handle routing via useInitialRouting.
    // This prevents issues on Android where Expo Router pre-renders all layouts.
    if (
      currentPathname === "/" ||
      currentPathname === "/signin" ||
      currentPathname === "/(auth)/signin" ||
      currentPathname.includes("/signin") ||
      currentPathname.startsWith("/(auth)") ||
      currentPathname.startsWith("/(landing)") ||
      currentPathname.startsWith("/(tabs)")
    ) {
      return;
    }

    // CRITICAL: Check hasRedirected FIRST before any other logic
    if (hasRedirectedRef.current) {
      return;
    }

    // Prevent multiple redirects
    if (redirectingRef.current) {
      return;
    }

    // Only redirect if not loading and not authenticated
    if (!isLoading && !isAuthenticated) {
      redirectingRef.current = true;
      hasRedirectedRef.current = true; // Set BEFORE redirect to prevent loops

      // Use setTimeout to defer redirect to next event loop tick
      // This prevents the redirect from causing an immediate re-render loop
      const timeoutId = setTimeout(() => {
        try {
          // On web, use window.location.href to avoid router re-render loops
          // On native, use router.replace
          if (Platform.OS === "web") {
            window.location.href = "/";
          } else {
            router.replace("/");
          }
        } catch (error) {
          hasRedirectedRef.current = false; // Reset on error so we can retry
        } finally {
          redirectingRef.current = false;
        }
      }, 50); // Small delay to prevent immediate re-render loop

      return () => clearTimeout(timeoutId);
    }
    // Use pathname inside effect, don't add to dependencies to prevent loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, isAuthenticated, router]);

  // CRITICAL: If we're not on a (user) route, don't show spinners or block rendering.
  // This handles Expo Router pre-rendering layouts on Android.
  const isUserRoute = pathname.startsWith("/(user)") || pathname.includes("(user)");
  if (!isUserRoute && pathname !== "") {
    return <>{children}</>;
  }

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!isAuthenticated) {
    // Show loading while redirecting
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return <>{children}</>;
}
