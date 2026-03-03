# Google OAuth Setup Guide

## Error 400: invalid_request

If you're seeing "Error 400: invalid_request" when trying to sign in with Google, it means the redirect URI is not properly configured in Google Cloud Console.

## Required Setup Steps

### 1. Get Your Redirect URI

When you run the app, check the console logs. You'll see a log like:
```
🔐 Google OAuth Redirect URI: https://auth.expo.io/@your-username/togather
```

**For Web Platform:**
- Development: `http://localhost:8081`
- Production: Your production domain (e.g., `https://yourdomain.com`)

**For Mobile Platforms (iOS/Android):**
- Expo proxy: `https://auth.expo.io/@your-username/togather`
- Or custom scheme: `togather://` (based on your app.json scheme)

### 2. Configure Redirect URIs in Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project
3. Navigate to **APIs & Services** → **Credentials**
4. Click on your OAuth 2.0 Client ID (or create one if needed)
5. Add the following **Authorized redirect URIs**:

   **For Web Client ID:**
   - `http://localhost:8081`
   - `https://auth.expo.io/@your-username/togather` (if using Expo proxy)
   - Your production domain redirect URIs

   **For iOS Client ID:**
   - `https://auth.expo.io/@your-username/togather` (if using Expo proxy)
   - `togather://` (if using custom scheme)

   **For Android Client ID:**
   - `https://auth.expo.io/@your-username/togather` (if using Expo proxy)
   - `togather://` (if using custom scheme)

### 3. Verify Client ID Configuration

Make sure you're using the correct Client ID type for each platform:

- **Web**: Use a "Web application" type Client ID
- **iOS**: Use an "iOS" type Client ID (requires bundle ID: `co.gettogather.app`)
- **Android**: Use an "Android" type Client ID (requires package name: `co.gettogather.app`)

### 4. Current Configuration

The app is currently configured to use a single Client ID for all platforms:
- Client ID: `67418361973-se97viugq5j1sitfph6h7h5k56ahdufk.apps.googleusercontent.com`
- This is an iOS Client ID from the deprecated app

**To fix the error, you need to:**

1. **Option A**: Create a Web Client ID and add all redirect URIs to it
2. **Option B**: Use platform-specific Client IDs (recommended)

### 5. Platform-Specific Setup

#### For Web Platform:
1. Create a "Web application" OAuth 2.0 Client ID
2. Add authorized JavaScript origins:
   - `http://localhost:8081` (development)
   - Your production domain
3. Add authorized redirect URIs:
   - `http://localhost:8081` (development)
   - Your production callback URLs

#### For iOS Platform:
1. Create an "iOS" OAuth 2.0 Client ID
2. Enter bundle ID: `co.gettogather.app`
3. The redirect URI will be automatically handled by Expo

#### For Android Platform:
1. Create an "Android" OAuth 2.0 Client ID
2. Enter package name: `co.gettogather.app`
3. Get your SHA-1 certificate fingerprint:
   ```bash
   keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android
   ```
4. Add the SHA-1 fingerprint to the Client ID configuration

### 6. Environment Variables

Set the appropriate Client IDs in your environment or `app.json`:

```json
{
  "expo": {
    "extra": {
      "googleClientId": "your-web-client-id.apps.googleusercontent.com"
    }
  }
}
```

Or use environment variables:
- `EXPO_PUBLIC_GOOGLE_CLIENT_ID` - For web
- `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` - For iOS
- `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` - For Android

### 7. Testing

After configuring:
1. Restart your Expo development server
2. Check the console logs for the redirect URI being used
3. Make sure that exact redirect URI is added to Google Cloud Console
4. Try signing in again

## Common Issues

### Issue: "redirect_uri_mismatch"
**Solution**: The redirect URI in your request doesn't match any of the authorized redirect URIs in Google Cloud Console. Add the exact redirect URI from the console logs.

### Issue: "invalid_client"
**Solution**: The Client ID you're using doesn't exist or is for a different platform. Make sure you're using the correct Client ID type.

### Issue: "Error 400: invalid_request"
**Solution**: Usually means the redirect URI is not registered. Follow steps 1-2 above to add the redirect URI to Google Cloud Console.

## Debugging

Enable debug logging by checking the console. The app logs:
- The redirect URI being used
- The Client IDs being used for each platform
- Any OAuth errors with details

Look for logs starting with `🔐` to see what's being sent to Google.

