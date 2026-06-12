/**
 * DEMO: render the REAL mobile-app `CommunitySelectionScreen` on the web with
 * mock data and no backend.
 *
 * The real screen is rendered via react-native-web inside the app's real
 * ThemeProvider (forced to dark — see demo/stubs/async-storage.ts). Its Convex,
 * auth, router, icon, gesture, and safe-area dependencies are swapped for the
 * mock modules under ./harness via aliases in vite.config.ts. The community
 * list comes from ./harness/fixtures.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "../../mobile/providers/ThemeProvider";
import { AuthProvider } from "./harness/AuthProvider";
import { CommunitySelectionScreen } from "../../mobile/features/auth/components/CommunitySelectionScreen";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <CommunitySelectionScreen />
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
);
