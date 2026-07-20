import type { ReactElement } from "react";
import App from "./App.tsx";
import { PrivacyPolicy } from "./pages/PrivacyPolicy.tsx";
import { TermsOfService } from "./pages/TermsOfService.tsx";
import { AndroidDownload } from "./pages/AndroidDownload.tsx";
import { Contribute } from "./pages/Contribute.tsx";
import { ContributeAI } from "./pages/ContributeAI.tsx";
import { ReportIssue } from "./pages/ReportIssue.tsx";
import { Developers } from "./pages/Developers.tsx";
import { Guides } from "./pages/Guides.tsx";
import { CreateCommunity } from "./pages/guides/CreateCommunity.tsx";
import { Pricing } from "./pages/guides/Pricing.tsx";
import { Branding } from "./pages/guides/Branding.tsx";
import { GroupTypes } from "./pages/guides/GroupTypes.tsx";
import { GroupsAndChannels } from "./pages/guides/GroupsAndChannels.tsx";
import { Events } from "./pages/guides/Events.tsx";
import { EventPlans } from "./pages/guides/EventPlans.tsx";
import { CheckIn } from "./pages/guides/CheckIn.tsx";
import { Prayer } from "./pages/guides/Prayer.tsx";
import { guides } from "./guides/registry.ts";

/**
 * Site-wide route registry: the single source of truth for the router,
 * per-page <head> metadata, and the build-time OG preview generation
 * (scripts/ in this package). Adding a page here is the ONLY way to add a
 * route, which guarantees every page ships with link-preview metadata. For a
 * NEW TOP-LEVEL path (not nested under an existing prefix like /guides/),
 * you must also add it to LANDING_PAGE_PATHS or LANDING_PAGE_PREFIXES in
 * apps/link-preview/cloudflare-worker.js, or the worker will misroute it
 * (single-segment paths otherwise fall into the community-slug redirect).
 */
export type PageMeta = {
  /** Route path, e.g. "/guides/branding". Static paths only — no params. */
  path: string;
  /** Page <title> and og:title. */
  title: string;
  /** Meta description and og:description. */
  description: string;
  /**
   * Optional bespoke share image (root-relative like "/og-image.png" or
   * absolute URL). When absent, the build generates a branded card at
   * /og/<slug>.png where <slug> is the path with "/" mapped to "-"
   * ("/" itself maps to "home").
   */
  image?: string;
  /** Optional emoji shown on the generated card. */
  emoji?: string;
};

export type RouteEntry = PageMeta & { element: ReactElement };

// Guide page components, keyed by the same slug used in guides/registry.ts.
// Title/description below are derived from that registry rather than
// duplicated here — the registry stays the single source of truth for guide
// copy.
const guideComponents: Record<string, ReactElement> = {
  "create-your-community": <CreateCommunity />,
  pricing: <Pricing />,
  branding: <Branding />,
  "group-types": <GroupTypes />,
  "groups-and-channels": <GroupsAndChannels />,
  events: <Events />,
  "event-plans": <EventPlans />,
  "check-in": <CheckIn />,
  prayer: <Prayer />,
};

const guideRoutes: RouteEntry[] = guides.map((guide) => {
  const element = guideComponents[guide.slug];
  if (!element) {
    throw new Error(`No guide component registered for slug "${guide.slug}"`);
  }
  return {
    path: `/guides/${guide.slug}`,
    title: `${guide.title} | Togather Guides`,
    description: guide.summary,
    emoji: guide.emoji,
    element,
  };
});

export const routes: RouteEntry[] = [
  {
    path: "/",
    title: "Togather - Connect Your Community",
    description:
      "Togather brings your groups, messaging, and events together in one place. The all-in-one platform for churches and communities.",
    image: "/og-image.png",
    element: <App />,
  },
  {
    path: "/android",
    title: "Download Togather for Android | Togather",
    description:
      "Togather for Android is in Google Play closed testing — join the testers group and get 3 steps from opt-in to install.",
    element: <AndroidDownload />,
  },
  {
    path: "/android-staging",
    title: "Togather Android Staging Build | Togather",
    description:
      "Internal staging build of Togather for Android — download the latest APK and install instructions for testers.",
    element: <AndroidDownload variant="staging" />,
  },
  {
    path: "/contribute",
    title: "Contribute to Togather",
    description:
      "Togather is built by the communities that use it. Report a bug, request a feature, or contribute code to the open-source AGPL-3.0 project.",
    element: <Contribute />,
  },
  {
    path: "/contribute/ai",
    title: "Contribute Without Writing Code | Togather",
    description:
      "How Togather's AI-driven development workflow turns your bug reports and feature ideas into working code, reviewed and shipped by maintainers.",
    element: <ContributeAI />,
  },
  {
    path: "/issue",
    title: "Report an Issue | Togather",
    description:
      "How to report a bug or request a feature for Togather on GitHub, with tips for writing a report the community can act on fast.",
    element: <ReportIssue />,
  },
  {
    path: "/guides",
    title: "Togather Guides",
    description:
      "Step-by-step guides for setting up and running your Togather community, from creating it to enabling prayer.",
    element: <Guides />,
  },
  ...guideRoutes,
  {
    path: "/legal/privacy",
    title: "Privacy Policy | Togather",
    description:
      "How Togather collects, uses, discloses, and safeguards your information when you use the app and related services.",
    element: <PrivacyPolicy />,
  },
  {
    path: "/legal/terms",
    title: "Terms of Service | Togather",
    description:
      "The terms governing your use of the Togather app, including account rules, content policy, and moderation.",
    element: <TermsOfService />,
  },
  {
    path: "/developers",
    title: "Developer API | Togather",
    description:
      "A read-only HTTP API for pulling a community's group attendance data out of Togather, for dashboards and reporting.",
    element: <Developers />,
  },
];

/** OG image slug for a route path: "/" -> "home", "/guides/branding" -> "guides-branding". */
export function ogSlug(path: string): string {
  return path === "/" ? "home" : path.replace(/^\//, "").replace(/\//g, "-");
}
