/**
 * DEMO: render the REAL mobile-app admin `SettingsContent` on the web with mock
 * data and no backend. Uses the shared demo harness (see vite.config.ts aliases)
 * and registers the render-time fixtures below so the Branding + Group Types
 * sections populate. Embedded by the Branding and Group Types guide pages.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "../../mobile/providers/ThemeProvider";
import { AuthProvider } from "./harness/AuthProvider";
import { registerFixtures } from "./harness/convex";
import { SettingsContent } from "../../mobile/features/admin/components/SettingsContent";

registerFixtures({
  // Community settings — drives Basic Info, Address, and Branding Colors.
  "functions.admin.settings.getCommunitySettings": {
    id: "fount",
    name: "FOUNT",
    logo: null,
    subdomain: "fount",
    addressLine1: null,
    addressLine2: null,
    city: "Brooklyn",
    state: "NY",
    zipCode: "11201",
    country: "US",
    primaryColor: "#1E8449",
    secondaryColor: "#2E86C1",
    exploreDefaultGroupTypes: [],
    exploreDefaultMeetingType: null,
    churchFeatures: { prayerEnabled: true },
  },

  // Group types — drives the Explore filter chips and the Group Types list.
  "functions.admin.settings.listGroupTypes": [
    {
      id: "gt_small_groups",
      name: "Small Groups",
      slug: "small-groups",
      description: "Weekly small group gatherings",
      icon: "people",
      isActive: true,
      displayOrder: 1,
      groupCount: 12,
    },
    {
      id: "gt_teams",
      name: "Teams",
      slug: "teams",
      description: "Ministry and service teams",
      icon: "people",
      isActive: true,
      displayOrder: 2,
      groupCount: 8,
    },
    {
      id: "gt_classes",
      name: "Classes",
      slug: "classes",
      description: "Educational classes and workshops",
      icon: "people",
      isActive: true,
      displayOrder: 3,
      groupCount: 3,
    },
    {
      id: "gt_announcements",
      name: "Announcements",
      slug: "announcements",
      description: "Community announcements",
      icon: "people",
      isActive: true,
      displayOrder: 4,
      groupCount: 1,
    },
  ],

  // Billing status — drives the Billing section.
  "functions.ee.billing.getSubscriptionStatus": {
    subscriptionStatus: "active",
    subscriptionPriceMonthly: 99,
  },

  // Integrations — empty is fine; the hook renders the "No integrations" state.
  "functions.integrations.listAvailable": [],
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <SettingsContent />
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
);
