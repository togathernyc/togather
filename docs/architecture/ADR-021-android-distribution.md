# ADR-021: Android Distribution via Direct APK Download

## Status
Accepted

## Date
2025-01-17

## Context

With the iOS app approved on the App Store, we needed a distribution strategy for Android that:
1. Avoids the complexity and time of Google Play Store submission
2. Provides seamless updates when new versions are released
3. Integrates with our existing CI/CD pipeline
4. Works well with Expo's OTA update system

## Decision

We distribute Android APKs directly from our website, hosted on Cloudflare R2.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CI/CD Pipeline                          │
│  (GitHub Actions: build-mobile.yml)                             │
│                                                                 │
│  1. EAS builds Android APK                                      │
│  2. Downloads APK from EAS                                      │
│  3. Uploads to R2:                                              │
│     - releases/android/togather-{version}.apk                   │
│     - releases/android/togather-latest.apk                      │
│     - releases/android/manifest.json                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Cloudflare R2 Bucket                         │
│  (togather-images → images.togather.nyc)                        │
│                                                                 │
│  /releases/android/                                             │
│    ├── manifest.json          # Version info, download URLs     │
│    ├── togather-latest.apk    # Always points to latest         │
│    ├── togather-1.0.20.apk    # Versioned APKs                  │
│    └── togather-1.0.21.apk                                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Download Page                                │
│  (togather.nyc/android)                                         │
│                                                                 │
│  - Fetches manifest.json for version info                       │
│  - Shows current version, release date, file size               │
│  - Download button links to versioned APK                       │
│  - Installation instructions for sideloading                    │
└─────────────────────────────────────────────────────────────────┘
```

### Update Flow

**For JavaScript/asset changes (95% of updates):**
- Expo OTA updates handle this automatically
- No APK download needed
- Updates applied on next app launch

**For native code changes (rare):**
1. App detects incompatible update via expo-updates fingerprint check
2. `NativeUpdateModal` appears directing user to download page
3. User downloads new APK from `togather.nyc/android`
4. User installs update (sideloading)

### R2 Storage

We reuse the existing `togather-images` bucket (domain: `images.togather.nyc`) rather than creating a separate bucket. APKs are stored under the `releases/android/` prefix.

**Why reuse the images bucket?**
- Already configured with public access
- No additional Cloudflare setup needed
- URLs work fine (users don't see them directly)

### Manifest Schema

```json
{
  "version": "1.0.20",
  "releaseDate": "2025-01-17T15:30:00Z",
  "fileSize": 52428800,
  "downloadUrl": "https://images.togather.nyc/releases/android/togather-1.0.20.apk",
  "latestUrl": "https://images.togather.nyc/releases/android/togather-latest.apk",
  "minSupportedVersion": "1.0.0"
}
```

The `minSupportedVersion` field can be used to force updates when critical fixes are needed.

## Files Changed

- `apps/web/android/index.html` - Download page
- `apps/web/index.html` - Updated links (TestFlight → App Store, added Android)
- `apps/mobile/components/ui/TestFlightBanner.tsx` - Now handles both iOS/Android
- `apps/mobile/components/ui/NativeUpdateModal.tsx` - New component for update prompts
- `apps/mobile/app/_layout.tsx` - Added NativeUpdateModal
- `.github/workflows/build-mobile.yml` - Added R2 upload steps

## Consequences

### Positive
- No Play Store review delays
- Full control over distribution
- Seamless CI/CD integration
- Works with existing infrastructure (R2, Cloudflare)
- Users get updates faster

### Negative
- Users must enable "Install from unknown sources"
- No automatic background updates (user must manually download)
- Less discoverability than Play Store
- Must handle our own update notifications

### Mitigations
- Clear installation instructions on download page
- NativeUpdateModal prompts users when updates are needed
- Expo OTA handles most updates automatically (no APK needed)

## Future Considerations

1. **Play Store submission** - Can add later if needed for discoverability
2. **In-app update prompt** - Could add periodic check for new versions
3. **Separate CDN domain** - Could move to `cdn.togather.nyc` if URL aesthetics matter
4. **Delta updates** - Not currently supported, but APKs are reasonably sized
