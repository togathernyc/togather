# Google Sign-In Implementation Guide

## Current Status

⚠️ **Google Sign-In is currently hidden/disabled** - The component exists but is not visible in the UI until OAuth configuration is complete.

## Overview

The Google Sign-In functionality has been implemented but requires additional configuration in Google Cloud Console before it can be used. This document outlines the steps needed to enable and test Google Sign-In.

## Implementation Steps

### 1. Google Cloud Console Setup

#### Create OAuth 2.0 Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project (or create a new one)
3. Navigate to **APIs & Services** → **Credentials**
4. Click **Create Credentials** → **OAuth client ID**

#### For Web Platform:
1. Select **Web application** as the application type
2. Name it: "Togather Web Client"
3. Add **Authorized JavaScript origins**:
   - `http://localhost:8081` (development)
   - Your production domain (e.g., `https://yourdomain.com`)
4. Add **Authorized redirect URIs**:
   - `http://localhost:8081` (development)
   - `https://auth.expo.io/@your-username/togather` (if using Expo proxy)
   - Your production callback URLs
5. Copy the **Client ID** (ends with `.apps.googleusercontent.com`)

#### For iOS Platform:
1. Select **iOS** as the application type
2. Name it: "Togather iOS Client"
3. Enter **Bundle ID**: `co.gettogather.app`
4. Copy the **Client ID**

#### For Android Platform:
1. Select **Android** as the application type
2. Name it: "Togather Android Client"
3. Enter **Package name**: `co.gettogather.app`
4. Get your **SHA-1 certificate fingerprint**:
   ```bash
   # For debug keystore
   keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android
   
   # For release keystore (if you have one)
   keytool -list -v -keystore /path/to/your/release.keystore -alias your-key-alias
   ```
5. Add the SHA-1 fingerprint to the Client ID configuration
6. Copy the **Client ID**

### 2. Configure Client IDs in the App

#### Option A: Using app.json (Recommended for builds)

Update `apps/mobile/app.json`:

```json
{
  "expo": {
    "extra": {
      "googleClientId": "your-web-client-id.apps.googleusercontent.com",
      "googleIosClientId": "your-ios-client-id.apps.googleusercontent.com",
      "googleAndroidClientId": "your-android-client-id.apps.googleusercontent.com"
    }
  }
}
```

#### Option B: Using Environment Variables (For development)

Create a `.env` file in `apps/mobile/`:

```bash
EXPO_PUBLIC_GOOGLE_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=your-ios-client-id.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=your-android-client-id.apps.googleusercontent.com
```

### 3. Enable the Component

Once the Client IDs are configured, enable the Google Sign-In button:

1. Open `apps/mobile/features/auth/components/GoogleSignInButton.tsx`
2. Change line 20 from:
   ```typescript
   if (true) {
     return null;
   }
   ```
   To:
   ```typescript
   if (false) {
     return null;
   }
   ```
   Or simply remove the early return block.

### 4. Test the Implementation

1. **Start the development server:**
   ```bash
   cd apps/mobile
   npm start
   ```

2. **Check console logs:**
   - Look for logs starting with `🔐` to see:
     - The redirect URI being used
     - The Client IDs being used for each platform
     - Any OAuth errors

3. **Test the flow:**
   - Navigate to the sign-in screen
   - Click "Sign in with Google"
   - Complete the OAuth flow
   - Verify that tokens are stored and user is authenticated

### 5. Verify Redirect URIs

After enabling, check the console logs for the redirect URI. It should look like:
- Web: `http://localhost:8081` or your production domain (Note: Google blocks localhost loopback, see troubleshooting)
- Mobile: `togather://` (custom scheme)

**Important:** Make sure this exact redirect URI is added to your Google Cloud Console OAuth Client ID configuration.

**For Mobile (iOS/Android):**
- Add `togather://` to the Authorized redirect URIs in your Google Cloud Console OAuth client configuration

**For Web:**
- **Production (published website):** Will work! Just add your production domain (e.g., `https://togather.com`) to Google Cloud Console
- **Development (localhost):** Google blocks localhost. You have two options:
  1. Use a development tunnel (ngrok, Cloudflare Tunnel, etc.) and add that URL to Google Cloud Console
  2. Test on your published website instead of localhost

## Troubleshooting

### Error 400: invalid_request - Loopback flow blocked
- **Cause:** Google has blocked loopback IP addresses (127.0.0.1/localhost) for OAuth flows
- **Solution:** 
  - For mobile: Ensure you're using the custom scheme (`togather://`) and add it to Google Cloud Console
  - For web: Use a development tunnel (ngrok) or your production domain instead of localhost
  - Check the console logs for the exact redirect URI being used and ensure it matches what's in Google Cloud Console

### Error: redirect_uri_mismatch
- **Cause:** The redirect URI in the request doesn't match any authorized URIs
- **Solution:** Verify the redirect URI in console logs matches exactly what's in Google Cloud Console

### Error: invalid_client
- **Cause:** Client ID doesn't exist or is for wrong platform
- **Solution:** Verify you're using the correct Client ID type (Web for web, iOS for iOS, etc.)

### Component not showing
- **Cause:** Component is still hidden (early return is active)
- **Solution:** Remove or disable the early return in `GoogleSignInButton.tsx`

## Code Structure

### Components
- `GoogleSignInButton.tsx` - The UI button component (currently hidden)
- `SignInForm.tsx` - Main sign-in form that includes Google button
- `SignInScreen.tsx` - Screen that uses SignInForm

### Hooks
- `useGoogleSignIn.ts` - Handles Google OAuth flow and API integration

### Services
- `authApi.googleLogin()` - Backend API call for Google authentication

## Backend Requirements

The backend endpoint `/member/google/` must be configured and accept:
- `access_token` (required) - Google OAuth access token
- `community_id` (optional) - Community ID for membership

The endpoint should:
1. Validate the Google access token
2. Get user info from Google
3. Create or authenticate the user
4. Return JWT tokens (access_token, refresh_token)

## Security Considerations

1. **Client IDs are public** - It's safe to include them in the app bundle
2. **Never expose Client Secrets** - Only Client IDs should be in the mobile app
3. **Use HTTPS** - Always use HTTPS for production redirect URIs
4. **Validate tokens server-side** - The backend must validate Google tokens

## Next Steps

1. ✅ Code implementation complete
2. ⏳ Configure Google Cloud Console OAuth credentials
3. ⏳ Add Client IDs to app configuration
4. ⏳ Enable the component
5. ⏳ Test on all platforms (web, iOS, Android)
6. ⏳ Update production configuration

## Related Documentation

- [Google OAuth Setup Guide](../../../docs/features/GOOGLE_OAUTH_SETUP.md)
- [Authentication Feature Docs](../../../docs/features/authentication.md)
- [Expo Auth Session Docs](https://docs.expo.dev/guides/authentication/#google)

