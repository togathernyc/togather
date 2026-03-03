# iOS Build Credentials for EAS

## Overview

When building iOS apps with EAS, you need Apple Developer credentials. Your `eas.json` is configured with `credentialsSource: "remote"`, which means EAS will manage credentials remotely. However, you still need to set them up initially.

## What the Terminal Prompt Means

When you see a prompt asking for Apple account credentials (lines 323-326), EAS CLI is asking if you want to:

1. **Provide Apple account credentials** - EAS will use these to automatically generate and manage certificates, provisioning profiles, etc.
2. **Skip for now** - You can set up credentials later via the EAS dashboard or CLI

## For CI/CD Pipelines

For CI/CD pipelines, you have two main approaches:

### Option 1: Let EAS Manage Credentials (Recommended)

This is what your current `eas.json` configuration uses (`credentialsSource: "remote"`).

**Setup Steps:**

1. **Skip the prompt** when running commands locally (you can type "no" or press Enter to skip)

2. **Set up credentials via EAS Dashboard:**
   - Go to [expo.dev](https://expo.dev)
   - Navigate to your project
   - Go to **Credentials** → **iOS**
   - Click **Set up credentials** or **Add credentials**
   - Choose one of:
     - **Automatic**: Provide your Apple Developer account email/password (EAS manages everything)
     - **Manual**: Upload certificates and provisioning profiles yourself

3. **Or set up via EAS CLI:**
   ```bash
   cd apps/mobile
   npx eas-cli@latest credentials
   ```
   This will guide you through setting up credentials interactively.

### Option 2: Manual Credential Management

If you prefer to manage credentials yourself:

1. **Change `eas.json`** to use local credentials:
   ```json
   {
     "build": {
       "preview": {
         "ios": {
           "credentialsSource": "local"
         }
       },
       "production": {
         "ios": {
           "credentialsSource": "local"
         }
       }
     }
   }
   ```

2. **Provide credentials manually** when prompted, or store them in environment variables.

## Where to Find Existing Credentials

### If Credentials Are Already Set Up

1. **EAS Dashboard:**
   - Go to [expo.dev](https://expo.dev) → Your Project → **Credentials** → **iOS**
   - View existing certificates, provisioning profiles, and app-specific credentials

2. **EAS CLI:**
   ```bash
   cd apps/mobile
   npx eas-cli@latest credentials
   ```
   Select iOS and view/export existing credentials

3. **Apple Developer Portal:**
   - Go to [developer.apple.com](https://developer.apple.com)
   - Navigate to **Certificates, Identifiers & Profiles**
   - View your certificates and provisioning profiles

## Setting Up Credentials for the First Time

### Method 1: Via EAS Dashboard (Easiest)

1. Go to [expo.dev](https://expo.dev)
2. Select your project
3. Navigate to **Credentials** → **iOS**
4. Click **Set up credentials** or **Add credentials**
5. Choose **Automatic setup** and provide:
   - Apple ID (email)
   - Apple ID password
   - App-Specific Password (if 2FA is enabled)
6. EAS will automatically:
   - Create certificates
   - Generate provisioning profiles
   - Manage everything for you

### Method 2: Via EAS CLI

```bash
cd apps/mobile
npx eas-cli@latest credentials
```

Follow the interactive prompts to:
- Select iOS platform
- Choose automatic or manual setup
- Provide Apple Developer account details

### Method 3: Manual Setup

If you already have certificates and provisioning profiles:

1. **Export from Xcode:**
   - Open your project in Xcode
   - Go to **Signing & Capabilities**
   - Export certificates and profiles

2. **Upload to EAS:**
   ```bash
   cd apps/mobile
   npx eas-cli@latest credentials
   ```
   Choose manual setup and upload your files

## For CI/CD: Environment Variables

If you need to provide credentials in CI/CD without interactive prompts:

### Option A: Use EAS Remote Credentials (Recommended)

Your `eas.json` already uses `credentialsSource: "remote"`, so credentials are stored in EAS. You just need:

1. **EXPO_TOKEN** for authentication:
   ```bash
   export EXPO_TOKEN=your-expo-token
   ```
   Get your token from: [expo.dev/accounts/[account]/settings/access-tokens](https://expo.dev/accounts/[account]/settings/access-tokens)

2. **No Apple credentials needed** - EAS uses the credentials you set up in the dashboard

### Option B: Provide Apple Credentials in CI/CD

If you must provide Apple credentials in CI/CD:

```bash
export APPLE_ID=your-apple-id@example.com
export APPLE_APP_SPECIFIC_PASSWORD=your-app-specific-password
```

**Note:** This is less secure and not recommended. Use EAS remote credentials instead.

## What to Do Right Now

### If You Said "No" to the Prompt

If you said "no" to providing Apple account credentials and now see the error:
> "You need to log in to your Apple Developer account to generate credentials for internal distribution builds, or provide credentials via credentials.json"

You have **three options**:

#### Option 1: Set Up Credentials via EAS CLI (Recommended)

Run the credentials command to set them up interactively:

```bash
cd apps/mobile
npx eas-cli@latest credentials
```

Then:
1. Select **iOS** platform
2. Choose **Set up credentials**
3. Choose **Automatic** (recommended)
4. Provide your Apple Developer account email
5. Provide your Apple ID password
6. If 2FA is enabled, provide an App-Specific Password

This will set up credentials in EAS, and future builds will use them automatically.

#### Option 2: Set Up Credentials via EAS Dashboard

1. Go to [expo.dev](https://expo.dev)
2. Navigate to your project (project ID: see `EAS_PROJECT_ID` in Infisical)
3. Go to **Credentials** → **iOS**
4. Click **Set up credentials** or **Add credentials**
5. Choose **Automatic setup**
6. Provide your Apple Developer account details

#### Option 3: Use credentials.json File (Advanced)

If you already have certificates and provisioning profiles, you can create a `credentials.json` file. However, this is more complex and not recommended unless you have existing credentials.

### If You Haven't Been Prompted Yet

When you see the prompt asking for Apple account credentials:

1. **For local development/testing:**
   - You can skip it (type "no" or press Enter)
   - Set up credentials later via the dashboard or CLI (see Option 1 or 2 above)

2. **For CI/CD:**
   - Skip the prompt
   - Set up credentials in the EAS dashboard first
   - Then your CI/CD pipeline will use those remote credentials automatically

3. **If you want to set up now:**
   - Type "yes" when prompted
   - Provide your Apple Developer account email
   - Provide your Apple ID password
   - If 2FA is enabled, provide an App-Specific Password

## Verifying Credentials Are Set Up

Check if credentials are configured:

```bash
cd apps/mobile
npx eas-cli@latest credentials
```

Or check in the EAS dashboard:
- [expo.dev](https://expo.dev) → Your Project → **Credentials** → **iOS**

## Troubleshooting

### "You need to log in to your Apple Developer account" Error

This error appears when:
- You said "no" to providing credentials interactively
- Credentials haven't been set up in EAS yet
- You're trying to build for internal distribution (preview profile)

**Solution:** Set up credentials using one of the methods above:
1. Run `npx eas-cli@latest credentials` (easiest)
2. Set up via EAS dashboard
3. Provide credentials when prompted next time

### "No credentials found" Error

This means credentials haven't been set up yet. Follow the setup steps above.

### "Invalid credentials" Error

1. Check credentials in EAS dashboard
2. Regenerate if needed:
   ```bash
   npx eas-cli@latest credentials
   ```
   Select iOS → Regenerate credentials

### Build Fails with Credential Errors

1. Verify credentials exist in EAS dashboard
2. Check that your Apple Developer account is active
3. Ensure your app's bundle identifier matches your Apple Developer account
4. Try regenerating credentials

## Additional Resources

- [EAS Credentials Documentation](https://docs.expo.dev/app-signing/managed-credentials/)
- [EAS Build Documentation](https://docs.expo.dev/build/introduction/)
- [Apple Developer Portal](https://developer.apple.com)

## Summary

- **Your config**: Uses `credentialsSource: "remote"` (EAS manages credentials)
- **For CI/CD**: Set up credentials once in EAS dashboard, then CI/CD uses them automatically
- **When prompted**: You can skip and set up later, or provide Apple account details now
- **Best practice**: Use EAS remote credentials (what you're already configured for)

