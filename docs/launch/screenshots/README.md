# Play Store Screenshots

Captured on Android emulator (`Medium_Phone_API_36.1`, 1080×2400) from the
**staging** build (`life.togather.staging`, EAS build `97fc4a8d`, versionCode 16)
logged in to **Demo Community** seed data.

| File | Screen | Listing use |
|---|---|---|
| `01-welcome.png` | Onboarding hero — "Your community, in your pocket" | Hero / first screenshot |
| `02-inbox.png` | Inbox — community channels & DMs | Messaging |
| `03-events.png` | Events — my events, upcoming, create | Events/RSVP |
| `04-team-chat.png` | Team channel — chat + Attendance/Run Sheet/Tasks | Group collaboration |
| `05-profile.png` | Profile — switch community, schedule, leader tools | Profile/admin |

## ⚠️ Before uploading to Play Console
- **Aspect ratio:** these are 1080×2400 (9:20 ≈ 2.22:1). Play's max phone
  screenshot ratio is **2:1**, so crop to **1080×2160** (or recapture on a 16:9
  device/framing tool) before upload to avoid rejection. Crop the top status bar
  / bottom gesture area, not app content.
- **Groups (map) tab is intentionally omitted** — it crashes on the *staging*
  build because the `preview` EAS environment has no `GOOGLE_MAPS_API_KEY`.
  Production has the key, so a production build can include a Groups/map shot.

## Note for staging Android testability
The staging Android build hard-crashes when opening the Groups tab:
```
java.lang.IllegalStateException: API key not found (com.google.android.geo.API_KEY)
```
iOS uses Apple Maps (no key), which is why this never surfaced on iOS. To make
staging Android usable end-to-end, add `GOOGLE_MAPS_API_KEY` to the EAS
**preview** environment (production already has it). Ensure the key's Android
SHA-256 restrictions include the Play App Signing key (see the launch runbook).
