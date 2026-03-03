# Google OAuth Setup from Scratch - Complete Guide

Since you don't have access to the old credentials, we'll create everything fresh. This guide will walk you through setting up Google OAuth for all platforms (Web, iOS, Android).

## Prerequisites

- A Google account (any Google account works)
- Access to [Google Cloud Console](https://console.cloud.google.com/)
- About 15-20 minutes

## Step 1: Create a New Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Sign in with your Google account
3. Click the project dropdown at the top (next to "Google Cloud")
4. Click **"New Project"**
5. Fill in:
   - **Project name**: `Togather App` (or any name you prefer)
   - **Organization**: Leave as default (or select if you have one)
   - **Location**: Leave as default
6. Click **"Create"**
7. Wait for the project to be created (usually 10-30 seconds)
8. Select your new project from the dropdown

## Step 2: Enable Required APIs

1. In your project, go to **APIs & Services** → **Library** (or search "APIs & Services" in the top search bar)
2. Search for **"Google Identity"** or **"Google+ API"**
3. Click on **"Google Identity Services API"** (or similar)
4. Click **"Enable"**
5. Wait for it to enable (usually instant)

## Step 3: Configure OAuth Consent Screen

This is required before you can create OAuth credentials.

1. Go to **APIs & Services** → **OAuth consent screen**
2. Select **"External"** (unless you have a Google Workspace account)
3. Click **"Create"**
4. Fill in the required fields:
   - **App name**: `Togather`
   - **User support email**: Your email address
   - **App logo**: (Optional - can skip)
   - **Application home page**: `https://togather.expo.app` (or your domain)
   - **Application privacy policy link**: (Optional - can add later)
   - **Application terms of service link**: (Optional - can add later)
   - **Authorized domains**: Leave empty for now
   - **Developer contact information**: Your email address
5. Click **"Save and Continue"**
6. **Scopes** (Step 2): Click **"Add or Remove Scopes"**
   - Select: `.../auth/userinfo.email`
   - Select: `.../auth/userinfo.profile`
   - Click **"Update"**
   - Click **"Save and Continue"**
7. **Test users** (Step 3): 
   - If you're testing, add your own email as a test user
   - Otherwise, click **"Save and Continue"**
8. **Summary** (Step 4): Review and click **"Back to Dashboard"**

**Note**: For production, you'll need to submit for verification, but for development/testing, you can use it in "Testing" mode.

## Step 4: Create OAuth 2.0 Client IDs

You'll need separate Client IDs for each platform. Let's create them one by one.

### 4a. Create Web Client ID

1. Go to **APIs & Services** → **Credentials**
2. Click **"+ CREATE CREDENTIALS"** → **"OAuth client ID"**
3. If prompted, select **"Web application"** as the application type
4. Fill in:
   - **Name**: `Togather Web Client`
   - **Authorized JavaScript origins**: Click **"+ ADD URI"** and add:
     - `https://togather.expo.app`
     - `http://localhost:8081` (for local development)
   - **Authorized redirect URIs**: Click **"+ ADD URI"** and add:
     - `https://togather.expo.app/`
     - `https://togather.expo.app` (without trailing slash)
     - `http://localhost:8081` (for local development)
5. Click **"CREATE"**
6. **IMPORTANT**: Copy the **Client ID** (it looks like: `xxxxx-xxxxx.apps.googleusercontent.com`)
   - Save this somewhere safe - you'll need it in Step 5
   - You can also download the JSON if you want, but you only need the Client ID
7. Click **"OK"**

### 4b. Create iOS Client ID

1. Still in **APIs & Services** → **Credentials**
2. Click **"+ CREATE CREDENTIALS"** → **"OAuth client ID"**
3. Select **"iOS"** as the application type
4. Fill in:
   - **Name**: `Togather iOS Client`
   - **Bundle ID**: `co.gettogather.app` (this must match your app.json)
5. Click **"CREATE"**
6. **IMPORTANT**: Copy the **Client ID**
   - Save this - you'll need it in Step 5
7. Click **"OK"**

### 4c. Create Android Client ID

1. Still in **APIs & Services** → **Credentials**
2. Click **"+ CREATE CREDENTIALS"** → **"OAuth client ID"**
3. Select **"Android"** as the application type
4. Fill in:
   - **Name**: `Togather Android Client`
   - **Package name**: `co.gettogather.app` (this must match your app.json)
   - **SHA-1 certificate fingerprint**: You'll need to get this from your keystore

#### Getting SHA-1 Fingerprint

**For Debug Builds (Development):**
```bash
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android
```

Look for the line that says `SHA1:` and copy that value (it looks like: `AA:BB:CC:DD:...`)

**For Release Builds (Production):**
If you have a release keystore:
```bash
keytool -list -v -keystore /path/to/your/release.keystore -alias your-key-alias
```

**Note**: For now, you can add the debug SHA-1. You can add the release SHA-1 later when you're ready to build for production.

5. Paste the SHA-1 fingerprint into the field
6. Click **"CREATE"**
7. **IMPORTANT**: Copy the **Client ID**
   - Save this - you'll need it in Step 5
8. Click **"OK"**

## Step 5: Update Your App Configuration

Now that you have all three Client IDs, let's configure your app to use them.

### Option A: Using app.json (Recommended for Production)

Update `apps/mobile/app.json`:

```json
{
  "expo": {
    "extra": {
      "googleClientId": "YOUR-WEB-CLIENT-ID.apps.googleusercontent.com",
      "googleIosClientId": "YOUR-IOS-CLIENT-ID.apps.googleusercontent.com",
      "googleAndroidClientId": "YOUR-ANDROID-CLIENT-ID.apps.googleusercontent.com"
    }
  }
}
```

**Replace:**
- `YOUR-WEB-CLIENT-ID.apps.googleusercontent.com` with your Web Client ID
- `YOUR-IOS-CLIENT-ID.apps.googleusercontent.com` with your iOS Client ID
- `YOUR-ANDROID-CLIENT-ID.apps.googleusercontent.com` with your Android Client ID

### Option B: Using Environment Variables (Recommended for Development)

Create a `.env` file in `apps/mobile/` (add it to `.gitignore` if it contains secrets):

```bash
EXPO_PUBLIC_GOOGLE_CLIENT_ID=YOUR-WEB-CLIENT-ID.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=YOUR-IOS-CLIENT-ID.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=YOUR-ANDROID-CLIENT-ID.apps.googleusercontent.com
```

**Note**: The code already supports both methods. Environment variables take precedence over `app.json` values.

## Step 6: Verify Your Configuration

1. Check that your `app.json` has the correct bundle ID/package name:
   - iOS: `"bundleIdentifier": "co.gettogather.app"`
   - Android: `"package": "co.gettogather.app"`

2. Verify your redirect URIs match:
   - The app uses `togather://` scheme for mobile (custom scheme)
   - The app uses `https://togather.expo.app/` for web
   - Check the console logs when running the app to see the exact redirect URI being used

## Step 7: Test the Setup

### For Web:

1. Start your development server:
   ```bash
   cd apps/mobile
   npm start
   ```

2. Open the app in your browser (usually `http://localhost:8081`)

3. Open the browser console (F12 or Cmd+Option+I)

4. Look for logs starting with `🔐`:
   - `🔐 Google OAuth Redirect URI: http://localhost:8081` (or your production URL)
   - `🔐 Google OAuth Client IDs: { web: "...", ios: "...", android: "...", platform: "web" }`

5. Navigate to the sign-in screen and click "Sign in with Google"

6. You should be redirected to Google's OAuth consent screen

7. After authorizing, you should be redirected back and signed in

### For Mobile (iOS/Android):

1. Build and run your app on a device or simulator

2. Check the console logs for the redirect URI (should be `togather://`)

3. Try signing in with Google

## Troubleshooting

### Error: "redirect_uri_mismatch"

**Problem**: The redirect URI in your request doesn't match what's configured in Google Cloud Console.

**Solution**:
1. Check the console logs for the exact redirect URI being used
2. Go to Google Cloud Console → Credentials → Your Client ID
3. Make sure that exact redirect URI is in the "Authorized redirect URIs" list
4. For web, make sure both `https://togather.expo.app/` and `https://togather.expo.app` are added
5. Wait a few minutes for changes to propagate

### Error: "invalid_client"

**Problem**: The Client ID is incorrect or the wrong type.

**Solution**:
1. Make sure you're using a **Web application** Client ID for web
2. Make sure you're using an **iOS** Client ID for iOS
3. Make sure you're using an **Android** Client ID for Android
4. Double-check that the Client ID is copied correctly (no extra spaces)

### Error: "access_denied" or OAuth consent screen issues

**Problem**: The OAuth consent screen isn't configured or you're not a test user.

**Solution**:
1. Go to Google Cloud Console → OAuth consent screen
2. Make sure you've completed all required steps
3. If in "Testing" mode, add your email as a test user
4. For production, you'll need to submit for verification

### Google Sign-In Button Not Showing

**Problem**: The button might be hidden if Client IDs aren't configured.

**Solution**:
1. Check that your Client IDs are set in `app.json` or environment variables
2. Restart your development server after changing configuration
3. Check the console for any error messages

## Next Steps

1. ✅ Test Google Sign-In on web
2. ✅ Test Google Sign-In on iOS (if you have an iOS device/simulator)
3. ✅ Test Google Sign-In on Android (if you have an Android device/emulator)
4. ✅ For production, submit your OAuth consent screen for verification
5. ✅ Add your production domain to authorized domains in OAuth consent screen

## Important Notes

- **Client IDs are public**: It's safe to include them in your code/app.json (they're meant to be public)
- **Client Secrets**: Web OAuth doesn't use client secrets (only mobile apps do, but Expo handles this)
- **Multiple Projects**: You can create separate Google Cloud projects for staging/production if needed
- **Cost**: Google OAuth is completely free to use
- **Security**: Only the Client ID is needed - never share or commit any client secrets if you see them

## Summary

You now have:
- ✅ A new Google Cloud project
- ✅ OAuth consent screen configured
- ✅ Web Client ID configured
- ✅ iOS Client ID configured
- ✅ Android Client ID configured
- ✅ App configured to use the new Client IDs

Your Google OAuth setup is complete! 🎉

