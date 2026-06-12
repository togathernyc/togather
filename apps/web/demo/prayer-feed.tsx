/**
 * DEMO: render the REAL mobile-app `PrayerScreen` on the web with mock data and
 * no backend. Uses the shared demo harness (see vite.config.ts aliases) and the
 * prayer fixtures in ./harness/fixtures.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "../../mobile/providers/ThemeProvider";
import { AuthProvider } from "./harness/AuthProvider";
import { PrayerScreen } from "../../mobile/features/prayer/components/PrayerScreen";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <PrayerScreen />
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
);
