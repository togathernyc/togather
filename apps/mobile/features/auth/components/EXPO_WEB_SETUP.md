# Google OAuth Setup for Expo Web Deployment

This guide will help you configure Google OAuth to work with your Expo web deployment at `https://togather.expo.app/`.

## Quick Setup Steps

### 1. Verify Your Google Client ID

Your current Client ID in `app.json` is:
```
67418361973-se97viugq5j1sitfph6h7h5k56ahdufk.apps.googleusercontent.com
```

**Important:** This appears to be an iOS Client ID. For web, you need a **Web application** Client ID.

### 2. Create or Use a Web Client ID

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to **APIs & Services** → **Credentials**
3. Either:
   - **Option A:** Create a new "Web application" OAuth 2.0 Client ID
   - **Option B:** If you already have a Web Client ID, use that one

### 3. Configure the Web Client ID

1. Click on your **Web application** Client ID (or create one)
2. Add **Authorized JavaScript origins**:
   - `https://togather.expo.app`
3. Add **Authorized redirect URIs**:
   - `https://togather.expo.app/`
   - `https://togather.expo.app` (without trailing slash, just in case)

### 4. Update Your App Configuration

You have two options:

#### Option A: Use Environment Variable (Recommended for different environments)

Create a `.env` file in `apps/mobile/`:
```bash
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
```

Or set it when deploying:
```bash
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=your-web-client-id.apps.googleusercontent.com eas build --platform web
```

#### Option B: Update app.json

Update `apps/mobile/app.json`:
```json
{
  "expo": {
    "extra": {
      "googleClientId": "your-web-client-id.apps.googleusercontent.com",
      "googleWebClientId": "your-web-client-id.apps.googleusercontent.com"
    }
  }
}
```

### 5. Deploy and Test

1. Deploy your app to Expo:
   ```bash
   eas update --platform web
   # or
   eas deploy --platform web
   ```

2. Visit `https://togather.expo.app/` and open the browser console
3. Look for the log: `🔐 Google OAuth Redirect URI: https://togather.expo.app/`
4. Verify this exact URI is in your Google Cloud Console
5. Try signing in with Google

## How It Works

When your app is deployed to `https://togather.expo.app/`:

- The `makeRedirectUri()` function automatically detects the current origin
- It will use `https://togather.expo.app/` as the redirect URI
- Google will redirect back to this URL after authentication
- The app will handle the OAuth callback automatically

## Troubleshooting

### Error: "redirect_uri_mismatch"

**Cause:** The redirect URI in the request doesn't match what's in Google Cloud Console.

**Solution:**
1. Check the browser console for the exact redirect URI being used
2. Make sure it's exactly `https://togather.expo.app/` (with trailing slash)
3. Add it to Google Cloud Console if it's not there

### Error: "invalid_client"

**Cause:** You're using the wrong type of Client ID (e.g., iOS Client ID for web).

**Solution:**
1. Make sure you're using a **Web application** Client ID for web
2. Update your app configuration to use the Web Client ID

### Error: "Error 400: invalid_request - Loopback flow blocked"

**Cause:** This shouldn't happen on the deployed site, but if you see it, check:
- Make sure you're not using `useProxy: true`
- Verify the redirect URI is `https://togather.expo.app/` and not `http://localhost:8081`

## Current Configuration Status

✅ **Code is configured correctly** - The redirect URI will automatically use `https://togather.expo.app/` when deployed

⏳ **Action Required:**
1. Create/configure a Web Client ID in Google Cloud Console
2. Add `https://togather.expo.app/` to Authorized redirect URIs
3. Update your app to use the Web Client ID (via environment variable or app.json)

## Next Steps After Setup

Once configured:
1. Deploy the app
2. Test Google sign-in on `https://togather.expo.app/`
3. Verify the OAuth flow completes successfully
4. Users should be able to sign in with Google!

