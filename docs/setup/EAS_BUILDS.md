# EAS Mobile Builds Guide

## Overview

This guide covers how to build iOS and Android apps using EAS (Expo Application Services). Builds are **not triggered automatically** on every push to avoid costs ($2/build).

## Cost Considerations

EAS charges **$2 per native build**. To manage costs:
- Builds are NOT triggered automatically on push
- Use manual triggers or git tags for intentional releases
- Web deployments are free and still automatic

## How to Trigger Builds

### Option 1: Manual Build (GitHub UI)

1. Go to [GitHub Actions](https://github.com/your-org/Togather/actions)
2. Click **"EAS Build"** workflow in the sidebar
3. Click **"Run workflow"** button
4. Select options:
   - **Platform**: `ios`, `android`, or `all`
   - **Profile**: `production` or `staging`
   - **Submit**: Whether to submit to app stores after build
5. Click **"Run workflow"**

### Option 2: Version Tag (Automatic)

Create a version tag to trigger a full production release:

```bash
# Create and push a version tag
git tag v1.0.0
git push origin v1.0.0
```

This automatically:
- Builds both iOS and Android (production profile)
- Submits to App Store and Google Play

**Tag naming convention**: Use semantic versioning with `v` prefix:

**Beta phase** (current):
- `v2.0.0-beta.1` - First beta release
- `v2.0.0-beta.2` - Second beta release
- `v2.0.0-beta.3` - Third beta release, etc.

**Post-launch**:
- `v2.0.0` - Public launch
- `v2.1.0` - Minor release (new features)
- `v2.1.1` - Patch release (bug fixes)
- `v3.0.0` - Major release (breaking changes)

> **Note**: Togather starts at `2.0.0` as it's the successor to the original app.

### Option 3: Local CLI Build

For quick local builds or testing:

```bash
cd apps/mobile

# Build iOS
eas build --platform ios --profile production

# Build Android
eas build --platform android --profile production

# Build both
eas build --platform all --profile production

# Staging builds (internal testing)
eas build --platform ios --profile staging
```

## Build Profiles

| Profile | Distribution | Use Case |
|---------|-------------|----------|
| `production` | App stores | Public releases |
| `staging` | Internal (TestFlight/Internal Testing) | Beta testing with staging API |

## Workflow Files

### GitHub Actions: `.github/workflows/eas-build.yml`

Handles manual triggers and tag-based releases via GitHub Actions.

### EAS Workflows: `apps/mobile/.eas/workflows/`

- `main-production-builds.yml` - Production builds (currently unused, use GitHub Actions instead)
- `staging-preview-builds.yml` - Staging web deployment only (builds commented out)

## Submission to App Stores

### Automatic Submission

When using git tags or manual trigger with "Submit" enabled, builds are automatically submitted to:
- **iOS**: App Store Connect (TestFlight first, then promote to production)
- **Android**: Google Play Console (Internal testing track)

### Manual Submission

If automatic submission fails or you want to submit manually:

```bash
cd apps/mobile

# Submit latest iOS build
eas submit --platform ios --latest

# Submit latest Android build
eas submit --platform android --latest

# Submit specific build by ID
eas submit --platform ios --id BUILD_ID
```

## Monitoring Builds

### View Build Status

1. **GitHub Actions**: Check workflow runs at GitHub Actions page
2. **EAS Dashboard**: [expo.dev](https://expo.dev) → Your project → Builds

### Build Notifications

EAS sends email notifications for:
- Build started
- Build completed (success/failure)
- Submission status

## Troubleshooting

### Build Fails

1. **Check logs**: View detailed logs on expo.dev
2. **Local test**: Run `eas build --local` to test locally
3. **Dependencies**: Ensure all native dependencies are properly configured

### Submission Fails

1. **iOS**: Check App Store Connect for any issues with your app metadata
2. **Android**: Check Google Play Console for policy violations

### Authentication Issues

```bash
# Re-authenticate with EAS
eas login

# Or set token for CI/CD
export EXPO_TOKEN=your-token-here
```

## Quick Reference

| Action | Command |
|--------|---------|
| Beta release | `git tag v2.0.0-beta.1 && git push origin v2.0.0-beta.1` |
| Production release | `git tag v2.0.0 && git push origin v2.0.0` |
| Manual build (iOS) | GitHub Actions → EAS Build → ios |
| Manual build (Android) | GitHub Actions → EAS Build → android |
| Local iOS build | `eas build --platform ios --profile production` |
| Local Android build | `eas build --platform android --profile production` |
| Submit to stores | `eas submit --platform all --latest` |
| Check build status | [expo.dev](https://expo.dev) → Builds |

## Related Documentation

- [EAS Web Deployment](./EAS_WEB_DEPLOYMENT.md) - Web deployment (free, automatic)
- [iOS Build Credentials](./IOS_BUILD_CREDENTIALS.md) - iOS certificate setup
- [Testing on Phone](./TESTING_ON_PHONE.md) - Installing builds on devices
