/**
 * Expo app configuration
 *
 * Environment variables:
 * - APP_VARIANT: Set to "staging" for staging builds (set by EAS)
 */

const { DOMAIN_CONFIG } = require("@togather/shared/config/domain");

const IS_STAGING = process.env.APP_VARIANT === "staging";

const getAppName = () => {
  if (IS_STAGING) return "Togather Staging";
  return "Togather";
};

const getBundleIdentifier = () => {
  if (IS_STAGING) return "life.togather.staging";
  return "app.gatherful.mobile";
};

const getAppIcon = () => {
  if (IS_STAGING) return "./assets/icon-staging.png";
  return "./assets/gatherful-logo.png";
};

/**
 * Get associated domains for Universal Links (iOS)
 * Staging app handles staging.togather.nyc
 * Production app handles togather.nyc and all community subdomains
 */
const getAssociatedDomains = () => {
  if (IS_STAGING) {
    return [
      "applinks:staging.togather.nyc",
      "webcredentials:staging.togather.nyc",
    ];
  }
  return [
    "applinks:togather.nyc",
    "applinks:*.togather.nyc",
    "webcredentials:togather.nyc",
    "webcredentials:*.togather.nyc",
  ];
};

/**
 * Get Android intent filters for App Links
 * Staging app handles staging.togather.nyc
 * Production app handles togather.nyc and all community subdomains
 */
const getAndroidIntentFilters = () => {
  if (IS_STAGING) {
    return [
      {
        action: "VIEW",
        autoVerify: true,
        data: [
          {
            scheme: "https",
            host: "staging.togather.nyc",
            pathPrefix: "/e/",
          },
          {
            scheme: "https",
            host: "staging.togather.nyc",
            pathPrefix: "/g/",
          },
          {
            scheme: "https",
            host: "staging.togather.nyc",
            pathPrefix: "/t/",
          },
          {
            scheme: "https",
            host: "staging.togather.nyc",
            pathPrefix: "/r/",
          },
          {
            scheme: "https",
            host: "staging.togather.nyc",
            pathPrefix: "/nearme",
          },
        ],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ];
  }
  return [
    {
      action: "VIEW",
      autoVerify: true,
      data: [
        // Root domain
        {
          scheme: "https",
          host: "togather.nyc",
          pathPrefix: "/e/",
        },
        {
          scheme: "https",
          host: "togather.nyc",
          pathPrefix: "/g/",
        },
        {
          scheme: "https",
          host: "togather.nyc",
          pathPrefix: "/t/",
        },
        {
          scheme: "https",
          host: "togather.nyc",
          pathPrefix: "/r/",
        },
        {
          scheme: "https",
          host: "togather.nyc",
          pathPrefix: "/nearme",
        },
        // Wildcard for community subdomains (e.g., fount.togather.nyc)
        {
          scheme: "https",
          host: "*.togather.nyc",
          pathPrefix: "/e/",
        },
        {
          scheme: "https",
          host: "*.togather.nyc",
          pathPrefix: "/g/",
        },
        {
          scheme: "https",
          host: "*.togather.nyc",
          pathPrefix: "/t/",
        },
        {
          scheme: "https",
          host: "*.togather.nyc",
          pathPrefix: "/r/",
        },
        {
          scheme: "https",
          host: "*.togather.nyc",
          pathPrefix: "/nearme",
        },
      ],
      category: ["BROWSABLE", "DEFAULT"],
    },
  ];
};

export default {
  expo: {
    name: getAppName(),
    slug: "togather",
    version: "1.0.22",
    orientation: "portrait",
    icon: getAppIcon(),
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    splash: {
      image: getAppIcon(),
      resizeMode: "contain",
      backgroundColor: "#ffffff"
    },
    ios: {
      supportsTablet: false,
      bundleIdentifier: getBundleIdentifier(),
      associatedDomains: getAssociatedDomains(),
      infoPlist: {
        NSCameraUsageDescription:
          "Togather uses your camera to take a profile photo that will be visible to other community members (for example, when you RSVP to events or appear in group member lists), and to capture photos to share in group chat conversations.",
        NSPhotoLibraryUsageDescription:
          "Togather accesses your photo library to select a profile photo (visible to other community members when you RSVP to events or appear in group member lists), to add cover images for groups and events, and to share photos in group chat conversations with other members.",
        NSPhotoLibraryAddUsageDescription:
          "Togather saves photos to your library when you choose to download images shared by other members in group chats or event cover photos."
      }
    },
    android: {
      adaptiveIcon: {
        foregroundImage: getAppIcon(),
        backgroundColor: "#ffffff"
      },
      package: getBundleIdentifier(),
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      intentFilters: getAndroidIntentFilters()
    },
    web: {
      favicon: getAppIcon(),
      bundler: "metro",
      output: "server"
    },
    // Note: experiments.reactServerFunctions removed - it causes React version
    // mismatch with Expo Go. API routes (+api.ts) work with just output: "server".
    plugins: [
      "expo-router",
      "expo-web-browser",
      "expo-sensors",
      "expo-calendar",
      "expo-contacts",
      "expo-mail-composer",
      "expo-localization",
      [
        "@sentry/react-native/expo",
        {
          url: "https://sentry.io/",
          project: process.env.SENTRY_PROJECT || "react-native",
          organization: process.env.SENTRY_ORG || "supa-media"
        }
      ]
    ],
    scheme: "togather",
    updates: {
      // EAS project ID is required here for OTA updates
      url: `https://u.expo.dev/${process.env.EAS_PROJECT_ID || "bfc79fc8-7066-4386-b9e0-52d0207ad8f4"}`
    },
    runtimeVersion: "1.0.21",
    extra: {
      // OTA version - set by CI during deployment (format: X.Y.Z.MMDDYY.HHMM)
      // Falls back to binary version for embedded builds
      otaVersion: process.env.OTA_VERSION || "1.0.22",
      // Build variant - used to determine environment at runtime
      // Set by EAS build profiles (staging vs production)
      isStaging: IS_STAGING,
      // streamApiKey removed - migration to Convex-native messaging complete
      mapboxAccessToken: process.env.EXPO_PUBLIC_MAPBOX_TOKEN || "",
      eas: {
        // TODO: Move EAS project ID to env var (EXPO_PUBLIC_PROJECT_ID) once all CI workflows are updated
        projectId: process.env.EAS_PROJECT_ID || "bfc79fc8-7066-4386-b9e0-52d0207ad8f4"
      },
      router: {}
    },
    owner: process.env.EXPO_OWNER || "lilseyi"
  }
};
