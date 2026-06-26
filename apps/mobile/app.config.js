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
            pathPrefix: "/nearme",
          },
          {
            scheme: "https",
            host: "staging.togather.nyc",
            pathPrefix: "/c/",
          },
          {
            scheme: "https",
            host: "staging.togather.nyc",
            pathPrefix: "/a/",
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
          pathPrefix: "/nearme",
        },
        {
          scheme: "https",
          host: "togather.nyc",
          pathPrefix: "/c/",
        },
        {
          scheme: "https",
          host: "togather.nyc",
          pathPrefix: "/a/",
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
          pathPrefix: "/nearme",
        },
        {
          scheme: "https",
          host: "*.togather.nyc",
          pathPrefix: "/c/",
        },
        {
          scheme: "https",
          host: "*.togather.nyc",
          pathPrefix: "/a/",
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
    version: "1.0.23",
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
      entitlements: {
        "com.apple.developer.usernotifications.communication": true
      },
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSUserActivityTypes: ["INSendMessageIntent"],
        NSCameraUsageDescription:
          "Togather uses your camera to take a profile photo that will be visible to other community members (for example, when you RSVP to events or appear in group member lists), and to capture photos to share in group chat conversations.",
        NSPhotoLibraryUsageDescription:
          "Togather accesses your photo library to select a profile photo (visible to other community members when you RSVP to events or appear in group member lists), to add cover images for groups and events, and to share photos in group chat conversations with other members.",
        NSPhotoLibraryAddUsageDescription:
          "Togather saves photos to your library when you choose to download images shared by other members in group chats or event cover photos.",
        NSMicrophoneUsageDescription:
          "Togather uses your microphone to record voice messages to share in group chat conversations."
      }
    },
    android: {
      permissions: ["android.permission.RECORD_AUDIO"],
      // Strip permissions that get auto-merged in but the app never uses, to
      // avoid extra Google Play review scrutiny:
      // - SYSTEM_ALERT_WINDOW leaks in from react-native's debug manifest (dev
      //   overlay only); we never draw over other apps.
      // - CONTACTS/CALENDAR are injected by the expo-contacts/expo-calendar
      //   config plugins, and ACTIVITY_RECOGNITION by expo-sensors — but none of
      //   those modules has any runtime usage in the app. Shipping sensitive
      //   permissions with no backing feature is a known Play rejection cause,
      //   and ACTIVITY_RECOGNITION additionally forces the Health Connect
      //   declaration. So we strip them. (If/when these features are built,
      //   remove the relevant entries here.)
      // NOTE: We intentionally do NOT block READ/WRITE_EXTERNAL_STORAGE. Although
      // targetSdk 35 ignores them, the app's minSdk is 24 — on Android 12/API 32
      // and older there is no READ_MEDIA_*, so expo-image-picker/media-library
      // still gate gallery access (profile/group/event photos) on these legacy
      // perms. Blocking them would break photo picking on those devices.
      blockedPermissions: [
        "android.permission.SYSTEM_ALERT_WINDOW",
        "android.permission.ACTIVITY_RECOGNITION",
        "android.permission.READ_CONTACTS",
        "android.permission.WRITE_CONTACTS",
        "android.permission.READ_CALENDAR",
        "android.permission.WRITE_CALENDAR"
      ],
      adaptiveIcon: {
        foregroundImage: getAppIcon(),
        backgroundColor: "#ffffff"
      },
      package: getBundleIdentifier(),
      // Firebase config for FCM push notifications. Production only — the file
      // contains the app.gatherful.mobile client, so a staging build (package
      // life.togather.staging) would fail the Google Services gradle check.
      ...(IS_STAGING ? {} : { googleServicesFile: "./google-services.json" }),
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      intentFilters: getAndroidIntentFilters(),
      config: {
        googleMaps: {
          apiKey: process.env.GOOGLE_MAPS_API_KEY || ""
        }
      }
    },
    web: {
      favicon: getAppIcon(),
      bundler: "metro",
      output: "server"
    },
    // Note: experiments.reactServerFunctions removed - it causes React version
    // mismatch with Expo Go. API routes (+api.ts) work with just output: "server".
    plugins: [
      "@bacons/apple-targets",
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
      // OTA forced floor — a monotonic serial of the most recent *forced*
      // release, carried forward unchanged on silent releases. OTAUpdateProvider
      // reads it off both the published update's manifest and the running
      // bundle, and force-reloads whenever the running serial is older than an
      // incoming update's. This keeps a forced release "sticky": a device that
      // missed the forced window still force-reloads even when a later silent
      // release supersedes it. Set per deploy by the "Deploy to Production"
      // workflow (OTA_FORCED_SERIAL); 0 until the first forced release.
      otaForcedSerial: Number(process.env.OTA_FORCED_SERIAL) || 0,
      // Build variant - used to determine environment at runtime
      // Set by EAS build profiles (staging vs production)
      isStaging: IS_STAGING,
      // streamApiKey removed - migration to Convex-native messaging complete
      mapboxAccessToken: process.env.EXPO_PUBLIC_MAPBOX_TOKEN || "",
      eas: {
        // TODO: Move EAS project ID to env var (EXPO_PUBLIC_PROJECT_ID) once all CI workflows are updated
        projectId: process.env.EAS_PROJECT_ID || "bfc79fc8-7066-4386-b9e0-52d0207ad8f4",
        build: {
          experimental: {
            ios: {
              appExtensions: [
                {
                  targetName: "NotificationServiceExtension",
                  bundleIdentifier: `${getBundleIdentifier()}.NotificationServiceExtension`,
                  entitlements: {
                    "com.apple.developer.usernotifications.communication": true
                  }
                }
              ]
            }
          }
        }
      },
      router: {}
    },
    owner: process.env.EXPO_OWNER || "lilseyi"
  }
};
