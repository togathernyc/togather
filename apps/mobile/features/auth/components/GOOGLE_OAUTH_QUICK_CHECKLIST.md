# Google OAuth Setup - Quick Checklist

Use this checklist as you go through the setup process. Check off each item as you complete it.

## Google Cloud Console Setup

- [ ] Created new Google Cloud project
- [ ] Enabled Google Identity Services API
- [ ] Configured OAuth consent screen (External, filled all required fields)
- [ ] Added scopes: `userinfo.email` and `userinfo.profile`
- [ ] Added test users (if in Testing mode)

## Client IDs Created

- [ ] **Web Client ID** created
  - [ ] Added authorized origins: `https://togather.expo.app`, `http://localhost:8081`
  - [ ] Added redirect URIs: `https://togather.expo.app/`, `https://togather.expo.app`, `http://localhost:8081`
  - [ ] Copied Client ID: `___________________________`

- [ ] **iOS Client ID** created
  - [ ] Bundle ID set to: `co.gettogather.app`
  - [ ] Copied Client ID: `___________________________`

- [ ] **Android Client ID** created
  - [ ] Package name set to: `co.gettogather.app`
  - [ ] SHA-1 fingerprint added (debug: `___________________________`)
  - [ ] Copied Client ID: `___________________________`

## App Configuration

- [ ] Updated `apps/mobile/app.json` with all three Client IDs, OR
- [ ] Created `.env` file in `apps/mobile/` with all three Client IDs

## Testing

- [ ] Tested Google Sign-In on **Web** (localhost)
- [ ] Verified redirect URI in console logs matches Google Cloud Console
- [ ] Tested Google Sign-In on **iOS** (if available)
- [ ] Tested Google Sign-In on **Android** (if available)

## Production Readiness

- [ ] OAuth consent screen submitted for verification (if going to production)
- [ ] Production domain added to authorized domains
- [ ] Release SHA-1 fingerprint added to Android Client ID (if needed)

---

## Quick Reference: Where to Find Things

**Google Cloud Console**: https://console.cloud.google.com/

**OAuth Consent Screen**: APIs & Services → OAuth consent screen

**Credentials**: APIs & Services → Credentials

**Your App Config**: `apps/mobile/app.json` (line 35-42)

**Full Setup Guide**: See `GOOGLE_OAUTH_SETUP_FROM_SCRATCH.md`

