# Google Play Launch Runbook

Step-by-step guide to publish **Togather** (`app.gatherful.mobile`) to the Google
Play Store. This is the Android counterpart to the iOS `ios-build` command.

**Status as of this writing:** Google is verifying the **Supa Media** developer
account (personal account, identity docs submitted). Everything below the
"Blocked until verification" line cannot be done until that email arrives. The
prep work above it is already done in the `feat/google-play-prep` branch.

---

## Background: why Android wasn't on Play before

See [ADR-021](../architecture/ADR-021-android-distribution.md) — the team
deliberately shipped Android as a **sideloaded APK** from `togather.nyc/android`
(Cloudflare R2) and deferred Play Store to "future". This runbook reverses that
deferral. The R2 sideload path stays in place; Play Store is added alongside it.

The app is **managed/prebuild** (the `android/` dir is gitignored build output).
EAS already builds a production **AAB** (`production` profile in
`apps/mobile/eas.json`) — the Play-ready format. Android push (FCM V1) already
works on the R2 APKs because the credential lives in the **EAS project**
(`bfc79fc8-7066-4386-b9e0-52d0207ad8f4`), not the repo — it carries over to the
Play build unchanged (same package name, same Expo project).

---

## Already done (in `feat/google-play-prep`)

- ✅ `eas.json` → added `submit.production.android` (`track: internal`,
  `releaseStatus: completed`). The dormant CI step
  (`deploy-to-production.yml:281`, `eas submit --platform android --latest`) now
  has a target.
- ✅ `app.config.js` → added `android.blockedPermissions` to strip
  `SYSTEM_ALERT_WINDOW` (leaks from RN's debug manifest) and the legacy
  `READ/WRITE_EXTERNAL_STORAGE` perms (dead on targetSdk 35). Reduces Play review
  scrutiny. Applies automatically on the next EAS build (it runs
  `expo prebuild --clean`).
- ✅ Store listing content + Data Safety + content rating drafted →
  [`play-store-listing.md`](./play-store-listing.md).
- ✅ Screenshots captured on emulator → `docs/launch/screenshots/`.
- ✅ targetSdk confirmed = 35 (meets Play's requirement for new apps).

---

## ⚠️ The one decision to make first: Play App Signing key

When you create the app, Play **App Signing** is mandatory for new apps. You
choose which key Google uses to sign the *distributed* app:

| Option | What happens | Downstream work | Risk |
|---|---|---|---|
| **A. Google-generated key (default, recommended by Google)** | Your EAS keystore (`Ulyar_HC6s`, SHA `FA:C6:…`) becomes the *upload* key; Google re-signs with its own key (a **different** SHA-256). | You **must** add Google's signing SHA-256 to assetlinks + Maps key + OAuth (see steps 5–6), or **deep links and maps break** on the Play build. | Lowest — Google holds the key; recoverable if upload key lost. |
| **B. Upload your existing EAS key as the signing key** | The distributed cert stays `FA:C6:…` — identical to your R2 APKs and current `assetlinks.json`. | **None.** Deep links, maps, OAuth all keep working with zero changes. | Higher — you own key custody; if the EAS keystore is lost, you can't update the app. |

**Recommendation:** For the smoothest launch, **Option B** — your deep links,
Maps, and OAuth already key off `FA:C6:…` everywhere, so reusing that key as the
Play signing key means steps 5–6 below become no-ops. The trade-off is key
custody (back up the EAS keystore via `eas credentials -p android` → download).
If you'd rather follow Google's best-practice security posture, pick **Option A**
and do steps 5–6.

> Export the current key for backup / upload:
> `cd apps/mobile && eas credentials -p android` → select the build profile →
> "Download keystore".

---

## Blocked until verification ───────────────────────────────

### 1. Create the app in Play Console
- Play Console → **Create app**. App name from
  [`play-store-listing.md`](./play-store-listing.md), default language en-US,
  type **App**, **Free**.
- The package name `app.gatherful.mobile` is set automatically on first upload —
  **it's permanent**, so confirm it matches before uploading.

### 2. Set up the Google Play service account (for `eas submit`)
1. Play Console → **Setup → API access** → link a Google Cloud project.
2. In Google Cloud Console → **IAM & Admin → Service Accounts** → create one
   (e.g. `eas-play-publisher`). Create a **JSON key** and download it.
3. Back in Play Console → **API access** → grant the service account access with
   the **Release** permission (Admin not required).
4. Upload the JSON to **EAS** (don't commit it — matches the `credentialsSource:
   remote` pattern used for builds):
   ```bash
   cd apps/mobile
   eas credentials -p android      # → "Google Service Account" → upload JSON
   ```
   With the key stored in EAS, `eas submit` finds it automatically — no
   `serviceAccountKeyPath` needed in `eas.json`, nothing secret in the repo or CI.

### 3. First build + upload
```bash
cd apps/mobile
eas build --platform android --profile production --non-interactive   # AAB
eas submit --platform android --latest --non-interactive              # → internal track
```
The AAB lands on the **internal testing** track (per `eas.json`). Confirm it
appears in Play Console → Testing → Internal testing.

### 4. Choose the app signing option (see decision box above)
Do this during the first AAB upload. If Option A, continue to steps 5–6. If
Option B, **skip steps 5–6** entirely.

### 5. (Option A only) Add the Play signing SHA-256 to `assetlinks.json`
1. Play Console → **Setup → App integrity → App signing** → copy the
   **App signing key certificate** SHA-256.
2. Edit `apps/link-preview/cloudflare-worker.js`, `production` fingerprints
   array (line ~55) — **append** it as a second entry (keep `FA:C6:…` so R2 APKs
   still verify):
   ```js
   production: [
     "FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C", // EAS upload key (R2 APKs)
     "XX:XX:…",  // ← Google Play App Signing key
   ],
   ```
3. Deploy the worker. Verify: `curl -s https://togather.nyc/.well-known/assetlinks.json`
   shows **two** fingerprints.

### 6. (Option A only) Add the Play signing SHA-256 to Google Maps + OAuth
- **Google Maps:** Google Cloud Console → APIs & Services → Credentials → the
  Android Maps API key (`GOOGLE_MAPS_API_KEY`). If it's restricted by Android app
  SHA-256, add the Play signing SHA (else the map renders blank on Play builds).
- **OAuth / Google Sign-In** (`expo-auth-session`): if any flow is SHA-pinned,
  add the Play signing SHA to its OAuth client.

### 7. Complete the store listing
From [`play-store-listing.md`](./play-store-listing.md):
- **Main store listing:** title, short + full description, app icon (512×512),
  feature graphic (1024×500), phone screenshots (from `screenshots/`), category,
  contact email, **privacy policy URL**.
- **Data safety** form (use the table in the listing doc).
- **Content rating** questionnaire (UGC + user-to-user chat — see listing doc).
- **App content:** target audience, ads declaration (none), news app (no).

### 8. Run the mandatory closed test (the 12-tester / 14-day gate)
> Personal accounts created after 2023-11-13 must run a **closed** test with
> ≥12 testers opted in for **14 continuous days** before applying for production.
> Internal testing does **not** count — it must be the **closed** track.

1. Play Console → Testing → **Closed testing** → create a track (e.g. "beta").
2. Add testers: create a **Google Group** or paste 12–15 Gmail addresses, and
   enable the **opt-in link**.
3. Promote the internal AAB to the closed track (or
   `eas.json` → change `track` to your closed track name and re-submit).
4. Send testers the opt-in link + instructions (see
   [`tester-instructions.md`](./tester-instructions.md)). Recruit **15**, not 12
   — a couple always opt in with the wrong account.
5. Keep them engaged for 14 consecutive days (Google checks real usage).

### 9. Apply for production access, then promote
- After 14 days, Play Console surfaces **"Apply for production access."** Submit;
  Google reviews your testing story.
- Once granted: promote the build to the **production** track. Optionally change
  `eas.json` `submit.production.android.track` from `internal` → `production` so
  future CI prod deploys publish directly.

---

## Notes & gotchas
- **versionCode** is auto-incremented by EAS (`appVersionSource: remote`,
  `autoIncrement: true`) — don't set it manually.
- **`runtimeVersion`** (`1.0.21`) must stay in sync with production native
  builds — do **not** bump it for this work.
- The committed prebuilt `android/` dir is stale/local; EAS regenerates it via
  `expo prebuild --clean` on every build, so `blockedPermissions` takes effect on
  cloud builds without re-prebuilding locally.
- After the deploy pipeline runs, **watch the deploy to green** — merge ≠ done.
