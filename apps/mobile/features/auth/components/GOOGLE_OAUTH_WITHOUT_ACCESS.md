# Setting Up Google OAuth Without Access to Old Cloud Console

If you don't have access to the previous developers' Google Cloud Console, you can create your own Google Cloud project. This is actually the recommended approach for taking over a project.

## Option 1: Create Your Own Google Cloud Project (Recommended)

### Step 1: Create a New Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Sign in with your own Google account (doesn't need to be the same as the old devs)
3. Click the project dropdown at the top
4. Click **"New Project"**
5. Name it something like "Togather App" or "Togather OAuth"
6. Click **"Create"**

### Step 2: Enable Google Identity API

1. In your new project, go to **APIs & Services** → **Library**
2. Search for "Google Identity" or "Google+ API"
3. Click on it and click **"Enable"**

### Step 3: Configure OAuth Consent Screen

1. Go to **APIs & Services** → **OAuth consent screen**
2. Choose **"External"** (unless you have a Google Workspace)
3. Fill in the required information:
   - App name: "Togather"
   - User support email: Your email
   - Developer contact: Your email
4. Click **"Save and Continue"**
5. Skip scopes for now (click **"Save and Continue"**)
6. Add test users if needed (click **"Save and Continue"**)
7. Review and go back to dashboard

### Step 4: Create OAuth 2.0 Client ID for Web

1. Go to **APIs & Services** → **Credentials**
2. Click **"Create Credentials"** → **"OAuth client ID"**
3. Select **"Web application"** as the application type
4. Name it: "Togather Web Client"
5. Add **Authorized JavaScript origins**:
   - `https://togather.expo.app`
6. Add **Authorized redirect URIs**:
   - `https://togather.expo.app/`
   - `https://togather.expo.app` (without trailing slash)
7. Click **"Create"**
8. **Copy the Client ID** (it will look like: `xxxxx-xxxxx.apps.googleusercontent.com`)

### Step 5: Update Your App Configuration

Update `apps/mobile/app.json`:

```json
{
  "expo": {
    "extra": {
      "googleClientId": "YOUR-NEW-WEB-CLIENT-ID.apps.googleusercontent.com",
      "googleWebClientId": "YOUR-NEW-WEB-CLIENT-ID.apps.googleusercontent.com"
    }
  }
}
```

Or use environment variables:

```bash
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=YOUR-NEW-WEB-CLIENT-ID.apps.googleusercontent.com
```

### Step 6: Deploy and Test

1. Deploy your app
2. Test Google sign-in on `https://togather.expo.app/`
3. It should work!

## Option 2: Try Using Existing Client ID (Quick Test)

You can try using the existing Client ID to see if it's already configured. However, since it's an iOS Client ID, it likely won't work for web.

### Test Steps:

1. Deploy your app with the current Client ID
2. Try signing in with Google
3. Check the browser console for errors
4. If you get "redirect_uri_mismatch" or "invalid_client", the Client ID isn't configured for web

**Note:** Even if this works, you should still create your own project for long-term maintenance.

## Option 3: Request Access to Existing Project

If you want to use the existing project:

1. Try to find who owns the Google account that created the project
2. Ask them to:
   - Add you as an owner/editor to the Google Cloud project, OR
   - Share the Client ID credentials and redirect URI configuration
3. This might be difficult if the old devs are unreachable

## Why Create Your Own Project?

✅ **Full Control**: You own and manage the credentials  
✅ **No Dependencies**: Don't need to contact old developers  
✅ **Security**: Old devs won't have access to your new credentials  
✅ **Flexibility**: Can configure it exactly how you need  
✅ **Free**: Google Cloud projects are free (OAuth is free to use)

## Important Notes

- **Client IDs are public**: It's safe to include them in your code/app.json
- **Client Secrets**: Web OAuth doesn't use client secrets (only mobile apps do)
- **Multiple Projects**: You can have multiple Google Cloud projects - one for each environment if needed
- **Cost**: Google OAuth is free to use (no charges)

## Troubleshooting

### "redirect_uri_mismatch" Error
- Make sure `https://togather.expo.app/` is exactly added to Authorized redirect URIs
- Check the console log for the exact redirect URI being used
- Make sure there are no typos

### "invalid_client" Error
- Make sure you're using a **Web application** Client ID (not iOS/Android)
- Verify the Client ID is correct in your app.json

### OAuth Consent Screen Issues
- Make sure you've completed the OAuth consent screen setup
- If testing, you might need to add test users

## Next Steps

1. Create your own Google Cloud project (5-10 minutes)
2. Create a Web Client ID
3. Update your app.json with the new Client ID
4. Deploy and test

This is the cleanest solution and gives you full control going forward!

