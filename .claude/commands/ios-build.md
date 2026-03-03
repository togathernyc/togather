# iOS Build and App Store Deployment

Guide for building iOS apps and submitting to App Store Connect.

## Version Management

This project uses a **bare workflow** with a native `ios/` folder. Version numbers must be updated in multiple places:

### Files to Update

1. **`apps/mobile/ios/Togather/Info.plist`** (Primary for native builds)
   - `CFBundleShortVersionString` - Marketing version shown in App Store (e.g., "1.0.13")
   - `CFBundleVersion` - Build number, auto-incremented by EAS

2. **`apps/mobile/app.config.js`** (Expo configuration)
   - `version` - Should match Info.plist CFBundleShortVersionString
   - `runtimeVersion` - Used for OTA updates compatibility

### How to Change Version

```bash
# In Info.plist, update:
<key>CFBundleShortVersionString</key>
<string>1.0.14</string>  # Change this

# In app.config.js, update:
version: "1.0.14",        # Match Info.plist
runtimeVersion: "1.0.14", # Match for OTA compatibility
```

**Important**: In bare workflow, EAS uses Info.plist for the actual build version, not app.config.js. Keep them in sync to avoid confusion.

---

## Local Builds (Free)

Local builds run on your Mac using EAS credentials but don't consume cloud build credits.

### Prerequisites
- Xcode installed with iOS SDK
- Valid Apple Developer account linked to EAS
- CocoaPods installed (`gem install cocoapods`)

### Build Command

```bash
cd apps/mobile
eas build --platform ios --profile production --local --non-interactive
```

### What Happens
1. EAS downloads your provisioning profiles and certificates
2. Build runs locally using Xcode on your machine
3. Outputs an `.ipa` file in `apps/mobile/`
4. Build number auto-increments per EAS profile settings

### Submit Local Build to App Store

```bash
# Find your IPA file
ls apps/mobile/build-*.ipa

# Submit to App Store Connect
eas submit --platform ios --path ./build-TIMESTAMP.ipa
```

---

## Cloud Builds ($2/build)

Cloud builds run on EAS servers. Useful when you don't have a Mac or need CI/CD.

### Build Only

```bash
cd apps/mobile
eas build --platform ios --profile production --non-interactive
```

### Build and Auto-Submit

```bash
cd apps/mobile
eas build --platform ios --profile production --auto-submit --non-interactive
```

This builds on EAS servers and automatically submits to App Store Connect when complete.

### Check Build Status

```bash
# List recent builds
eas build:list --platform ios --limit 5

# View specific build logs
eas build:view
```

---

## Adding Native Permissions

When adding Expo libraries that require native permissions (location, camera, contacts, etc.), update `Info.plist`:

### Common Permissions

```xml
<!-- Location -->
<key>NSLocationWhenInUseUsageDescription</key>
<string>Allow $(PRODUCT_NAME) to access your location to show nearby events</string>
<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>Allow $(PRODUCT_NAME) to access your location</string>

<!-- Motion/Sensors -->
<key>NSMotionUsageDescription</key>
<string>Allow $(PRODUCT_NAME) to detect device motion for interactive features</string>

<!-- Calendar -->
<key>NSCalendarsUsageDescription</key>
<string>Allow $(PRODUCT_NAME) to add events to your calendar</string>
<key>NSCalendarsFullAccessUsageDescription</key>
<string>Allow $(PRODUCT_NAME) to access your calendars</string>

<!-- Contacts -->
<key>NSContactsUsageDescription</key>
<string>Allow $(PRODUCT_NAME) to access your contacts to invite friends</string>

<!-- Camera -->
<key>NSCameraUsageDescription</key>
<string>Allow $(PRODUCT_NAME) to access your camera</string>

<!-- Microphone -->
<key>NSMicrophoneUsageDescription</key>
<string>Allow $(PRODUCT_NAME) to access your microphone</string>

<!-- Photos -->
<key>NSPhotoLibraryUsageDescription</key>
<string>Allow $(PRODUCT_NAME) to access your photos</string>
<key>NSPhotoLibraryAddUsageDescription</key>
<string>Allow $(PRODUCT_NAME) to save photos</string>
```

### After Adding Permissions

1. Rebuild the native app (OTA updates cannot add new permissions)
2. Test on device to verify permission prompts appear correctly

---

## OTA Updates vs Native Builds

### OTA Updates (No App Store Review)
- JavaScript/TypeScript code changes
- Asset changes (images, fonts)
- Does NOT require new build

```bash
cd apps/mobile
pnpm update:ota
```

### Native Builds Required
- New Expo libraries with native code
- New iOS permissions
- Changes to Info.plist, Podfile, or native Swift/Objective-C code
- Expo SDK upgrades

---

## Build Profiles

Defined in `apps/mobile/eas.json`:

- **preview**: Development/testing builds
- **production**: App Store distribution builds (auto-increment enabled)

---

## Troubleshooting

### "Provisioning profile doesn't support Push Notifications"
Use `eas build --local` instead of direct Xcode builds. EAS manages the correct distribution profiles.

### Build number conflicts
EAS auto-increments build numbers. If you get conflicts, check `eas build:list` for the latest build number.

### Version not updating
In bare workflow, update `Info.plist` directly. The `app.config.js` version is not used for native builds.
