# EAS Workflows Setup for 2.0 Rollout

## Overview

EAS Workflows automate the build and distribution process for the mobile app. This setup enables automatic builds on `main` branch, with production builds ready for TestFlight/Play Store when needed.

**Why EAS Workflows?**

- Automated builds on every push to `main` branch
- Internal distribution for quick feedback during development
- Production builds ready for broader beta testing (TestFlight/Play Store)

**Note**: Only active GitHub Actions workflows run automatically. EAS Workflows for mobile app builds also run automatically on push to `main`.

## Prerequisites

1. **Expo Account**: Sign up at [expo.dev](https://expo.dev) if you don't have one
2. **EAS CLI**: Install globally or use npx (recommended)

   **Option 1: Use npx (no installation required)**

   ```bash
   npx eas-cli@latest init
   ```

   **Option 2: Install globally**

   ```bash
   npm install -g eas-cli
   # Or if you get permission errors:
   sudo npm install -g eas-cli
   ```

   **Option 3: Install locally in the project**

   ```bash
   cd apps/mobile
   npm install --save-dev eas-cli
   # Then use: npx eas-cli init
   ```

3. **GitHub Repository**: Your repository must be accessible to link with EAS

## Initial Setup

### Step 1: Initialize EAS Project

Navigate to the mobile app directory and initialize EAS:

```bash
cd apps/mobile
npx eas-cli@latest init
# Or if you installed globally:
eas init
```

This will:

- Prompt you to log in to your Expo account (or create one)
  - You'll need to enter your email/username and password
  - If you don't have an account, you can create one during this process
- Create an EAS project linked to your Expo account
- Generate a `projectId` that will be added to `app.json`

**Note**: The `eas.json` file has already been created with the proper configuration. The `eas init` command will link your project to EAS and update `app.json` with the project ID.

**If you get "command not found: eas"**: Use `npx eas-cli@latest` instead of `eas` for all commands, or install it globally first.

### Step 2: Verify Configuration

After running `eas init`, verify that `app.json` has been updated with the `projectId`:

```json
{
  "expo": {
    "extra": {
      "eas": {
        "projectId": "your-project-id-here"
      }
    }
  }
}
```

The `eas.json` file should already be configured with two build profiles:

- **preview**: Internal distribution builds for quick testing
- **production**: App store ready builds for TestFlight/Play Store

## Workflow Configuration

### Branch Strategy

- **`main`** → Production builds (ready for app stores)

### Workflow Files

Two EAS workflow files exist in `.eas/workflows/`:

**Mobile Builds:**
1. **`main-production-builds.yml`**: Triggers on pushes to `main` branch
   - Builds production builds for iOS and Android
   - Ready for TestFlight/Play Store submission
   - Auto-increments version numbers

**Web Deployments:**
2. **`main-web-deploy.yml`**: Triggers on pushes to `main` branch
   - Deploys web app to production environment
   - Your live web application

**Note**: For web deployment setup and usage, see [EAS Web Deployment Guide](./EAS_WEB_DEPLOYMENT.md).

## GitHub Integration

### Link Repository to EAS

To enable automatic workflow triggers, link your GitHub repository to your EAS project:

1. Navigate to your project on [expo.dev](https://expo.dev)
2. Go to **Project Settings** → **GitHub**
3. Click **Install GitHub App** (if not already installed)
4. Select the repository that matches your Expo project
5. Connect the repository

Once linked, workflows will automatically trigger when you push to `main` branch.

**Important**: For automatic triggers to work, you must:

1. ✅ Run `eas init` to create the EAS project (populates `projectId` in `app.json`)
2. ✅ Link the GitHub repository in Expo dashboard
3. ✅ Commit and push the workflow files (`.eas/workflows/*.yml`) to your repository
4. ✅ Push to `main` branch

Without these steps, workflows will NOT trigger automatically on pushes.

## How Workflows Work

### Automatic Triggers

When you push commits to:

- **`main`** → Automatically builds production builds for iOS and Android, and deploys web app to production

### Manual Triggers

You can also manually trigger workflows:

```bash
cd apps/mobile
npx eas-cli@latest workflow:run main-production-builds.yml
```

### Viewing Builds

1. Go to [expo.dev](https://expo.dev)
2. Navigate to your project
3. Click on **Workflows** to see all workflow runs
4. Click on a specific run to see build progress and logs

## Accessing Builds

### Production Builds (TestFlight/Play Store)

Production builds from `main` are ready for submission:

**iOS - TestFlight**:

1. Builds are automatically created when you push to `main`
2. Submit to TestFlight using EAS Submit (see Extending to TestFlight section)

**Android - Google Play**:

1. Builds are automatically created when you push to `main`
2. Submit to Google Play Internal Testing using EAS Submit (see Extending to Play Store section)

## Extending to TestFlight/Play Store

### Adding TestFlight Submission

To automatically submit to TestFlight after production builds, update `main-production-builds.yml`:

```yaml
name: Main Production Builds

on:
  push:
    branches: ["main"]

jobs:
  build_android:
    type: build
    params:
      platform: android
      profile: production
  build_ios:
    type: build
    params:
      platform: ios
      profile: production
  submit_ios:
    type: submit
    params:
      platform: ios
      profile: production
    dependsOn: build_ios
```

### Adding Google Play Submission

To automatically submit to Google Play Internal Testing, update `main-production-builds.yml`:

```yaml
name: Main Production Builds

on:
  push:
    branches: ["main"]

jobs:
  build_android:
    type: build
    params:
      platform: android
      profile: production
  build_ios:
    type: build
    params:
      platform: ios
      profile: production
  submit_android:
    type: submit
    params:
      platform: android
      profile: production
    dependsOn: build_android
```

**Note**: You'll need to configure app store credentials in EAS first. See [EAS Submit documentation](https://docs.expo.dev/submit/introduction/) for details.

## Build Profiles Explained

### Preview Profile

Located in `eas.json`:

```json
{
  "build": {
    "preview": {
      "distribution": "internal",
      "ios": {
        "simulator": false
      },
      "android": {
        "buildType": "apk"
      }
    }
  }
}
```

- **Distribution**: Internal (for quick testing)
- **iOS**: Device builds (not simulator)
- **Android**: APK format (easy to install)

### Production Profile

Located in `eas.json`:

```json
{
  "build": {
    "production": {
      "autoIncrement": true,
      "ios": {
        "simulator": false
      },
      "android": {
        "buildType": "app-bundle"
      }
    }
  }
}
```

- **Auto-increment**: Automatically increments build numbers
- **iOS**: Device builds ready for App Store
- **Android**: App Bundle format (required for Play Store)

## Troubleshooting

### Workflows Not Triggering

1. **Check GitHub Integration**: Ensure repository is linked in Expo dashboard
2. **Check Branch Names**: EAS Workflows only trigger on `main` branch
3. **Check Workflow Files**: Verify `.eas/workflows/*.yml` files exist and are committed
4. **Check EAS Project**: Ensure `app.json` has a valid `projectId`

### Build Failures

1. **Validate Configuration Locally First**: Always validate your `eas.json` configuration before pushing to trigger EAS builds:

   ```bash
   cd apps/mobile
   npm run validate-eas
   ```

   This will check for common configuration errors like invalid node version formats.

2. **Test Build Locally**: Test that your project builds locally before running EAS builds:

   ```bash
   cd apps/mobile
   npm run build:local
   ```

   This validates `eas.json` and runs `expo export` to ensure the build process works.

3. **Check Build Logs**: View detailed logs on expo.dev
4. **Verify Credentials**: Ensure app store credentials are configured (for production builds)
5. **Check Dependencies**: Ensure all dependencies are properly installed
6. **Monorepo Context**: Workflows automatically use `apps/mobile` as the working directory

### Invalid Node Version Format

If you see errors like `"20" failed custom validation because 20 is not a valid version` or `"20.x" failed custom validation because 20.x is not a valid version`:

**The Issue**: EAS requires the full version format `X.Y.Z` (e.g., `"20.0.0"`), not just `"20"` or `"20.x"`.

1. **Fix the node version format** in `eas.json`:

   - ❌ Invalid: `"node": "20"` (too short)
   - ❌ Invalid: `"node": "20.x"` (wildcard not allowed)
   - ✅ Valid: `"node": "20.0.0"` or `"node": "20.18.0"` (full version format)

2. **Validate locally** before pushing:

   ```bash
   cd apps/mobile
   npm run validate-eas
   ```

   This will check that node versions are in the correct `X.Y.Z` format.

3. **Reproduce EAS validation locally** (recommended):

   ```bash
   cd apps/mobile
   npm run validate-eas-cli
   ```

   This uses EAS CLI to validate the configuration, reproducing the same validation that EAS does remotely. This is the most reliable way to catch configuration errors before pushing.

4. **Test the build locally**:

   ```bash
   cd apps/mobile
   npm run build:local
   ```

### Authentication Issues

If you see authentication errors:

```bash
cd apps/mobile
npx eas-cli@latest login
# Or if installed globally:
eas login
```

Or set an environment variable for CI/CD:

```bash
export EXPO_TOKEN=your-token-here
```

### Command Not Found: eas

If you get "command not found: eas", you have three options:

1. **Use npx (recommended, no installation needed)**:

   ```bash
   npx eas-cli@latest init
   npx eas-cli@latest login
   npx eas-cli@latest workflow:run staging-preview-builds.yml
   ```

2. **Install globally**:

   ```bash
   npm install -g eas-cli
   # Or if you get permission errors:
   sudo npm install -g eas-cli
   ```

3. **Install locally in the project**:
   ```bash
   cd apps/mobile
   npm install --save-dev eas-cli
   # Then use: npx eas-cli init
   ```

## Branch Strategy Summary

| Branch | Purpose    | Mobile Builds     | Web Deployment        |
| ------ | ---------- | ----------------- | --------------------- |
| `main` | Production | Production builds | Production deployment |

## Workflow Status

### GitHub Actions Workflows (Automatic)

- **`backend-ci.yml`** - Backend CI/CD (tests + Fly.io deployment)
- **`mobile-ci.yml`** - Mobile CI (tests + EAS builds)
- **`web-ci.yml`** - Web CI (tests, lint, type-check, build)
- **`test-all.yml`** - Comprehensive test suite (all packages)

All GitHub Actions workflows run automatically on push to `main` branch.

### EAS Workflows (Automatic)

- **EAS Workflows**: Run automatically on push to `main`
  - `main-production-builds.yml` - Mobile app production builds
  - `main-web-deploy.yml` - Web app production deployment

## Next Steps

1. ✅ Run `eas init` to link your project (if not done already)
2. ✅ Link GitHub repository in Expo dashboard
3. ✅ Push to `main` for production builds
4. ✅ Configure TestFlight/Play Store submission (optional)

## Additional Resources

- [EAS Workflows Documentation](https://docs.expo.dev/eas/workflows/get-started/)
- [EAS Build Documentation](https://docs.expo.dev/build/introduction/)
- [EAS Submit Documentation](https://docs.expo.dev/submit/introduction/)
- [EAS Hosting Documentation](https://docs.expo.dev/deploy/web/)
- [Internal Distribution Guide](https://docs.expo.dev/build/internal-distribution/)
- [EAS Web Deployment Guide](./EAS_WEB_DEPLOYMENT.md) - Complete guide for web deployment
