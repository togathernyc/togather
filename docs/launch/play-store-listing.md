# Togather — Google Play Store Listing Content

> First Google Play listing for **Togather** (Android package `app.gatherful.mobile`),
> a community app for churches and organizations. Already live on iOS with 800+ users.
> Prepared 2026-06-22. Verify every URL and the Data Safety answers in the Play Console
> against current behavior before submitting.

---

## 1. Store Listing

| Field | Value |
| --- | --- |
| **App name** (≤30 chars) | `Togather: Community & Groups` (28 chars) |
| **Short description** (≤80 chars) | `Run your church or community: groups, events, RSVPs, chat, and prayer.` (70 chars) |
| **Category** | **Social** (primary). Alt: Lifestyle. See §4 for rationale. |
| **Tags** | community, groups, church, events, RSVP, messaging, prayer, organizing, members, volunteering |
| **Contact email** | `togather@supa.media` (the support/contact address used in the app's legal pages) |
| **Website** | https://togather.nyc |
| **Privacy policy** | https://togather.nyc/legal/privacy |
| **Terms of service** | https://togather.nyc/legal/terms |

### Full description (≤4000 chars)

```
Togather is the all-in-one home for your church or community. Bring your groups,
events, conversations, and care into a single app so members stay connected and
leaders spend less time on logistics.

BUILD YOUR COMMUNITY
Give every team, ministry, small group, and campus its own space. Each group comes
with a General channel for everyone and a private Leaders channel. Turn on an
Announcements channel for one-way updates, and let leaders create custom channels
with shareable invite links. Organize groups under types like Small Group, Team,
Campus, or Course so members can find exactly where they belong.

DISCOVER GROUPS NEAR YOU
Explore groups on a map and filter by type to find the right fit. New members can
join open groups instantly or request access to approval-only groups.

PLAN EVENTS AND FILL THE ROOM
Create an event in a few taps, invite your group by push and text, and collect
RSVPs (Going, Maybe, or Can't Go) with plus-one headcounts. Send reminder rounds to
people who haven't responded, spin up an event-only chat for attendees, bundle
multiple dates into a series, and control exactly who can see each event.

REAL-TIME MESSAGING
Chat in group channels and direct messages with photos, voice messages, polls, and
shared event links. Conversations update live so no one misses a beat. Built-in
blocking, reporting, and content moderation keep every space safe.

ORGANIZE TEAMS AND SERVICES
A full service-planning suite for staffing any gathering. Build serving teams with
custom roles, collect volunteer availability, roster people into a visual grid, and
auto-send confirm or decline requests with reminders. Create a spreadsheet-style run
sheet with cascading clock times, songs, and role assignments, and share it read-only
with your whole team.

CARE FOR YOUR PEOPLE
Help leaders make sure no one slips through the cracks. See each group's members
triaged into Needs Attention, Watch, and Healthy, assign people to specific leaders,
and reach out by text, call, or in-person visit — every touch keeps your community
connected.

PRAY TOGETHER
An opt-in prayer space where members post requests (anonymously if they choose) and
pray for one another. A gentle feed surfaces requests that need prayer most, authors
can post updates and praise reports, and reporting tools keep it safe.

MAKE IT YOURS
Community leaders can set a custom name, logo, brand color, and a memorable link, so
the app feels like your own — in both light and dark mode.

Togather is open source. Communities are onboarded individually; request yours at
togather.nyc.

Questions or support: togather@supa.media
Privacy: https://togather.nyc/legal/privacy
```

(~2,750 characters — well under the 4,000 limit.)

---

## 2. Data Safety Form Answers

Top-level declarations:

- **Does your app collect or share any user data?** Yes.
- **Is all collected data encrypted in transit?** Yes (HTTPS/TLS to Convex, Twilio,
  Sentry, PostHog, Cloudflare R2, Expo, Mapbox/Google).
- **Do you provide a way for users to request data deletion?** Yes — in-app account
  deletion exists: Settings → Delete Account (`features/settings/components/DeleteAccountModal.tsx`
  → `deleteAccount` in `apps/convex/functions/users.ts`). Point the Data Safety form
  and privacy policy at this in-app path.

**Collection vs. sharing:** "Shared" in Play's sense means transferred to a third
party. Here, data goes to **service providers** acting on Togather's behalf
(infrastructure/processors), which Google generally does **not** count as "sharing."
Mark "Shared = No" for processor-only flows. The one nuance is analytics (PostHog) and
crash data (Sentry) — these are processors too, so "Shared = No," but they ARE
"Collected" for the Analytics/Diagnostics purposes.

| Data type | Collected? | Purpose | Shared w/ 3rd party? | Required or optional | Linked to identity? | Notes / SDK |
| --- | --- | --- | --- | --- | --- | --- |
| **Name** | Yes | App functionality (profile, member lists, RSVPs) | No (processors only) | Required | Yes | Stored in Convex |
| **Phone number** | Yes | Account management / authentication (OTP login); SMS notifications | No (processor: Twilio) | Required | Yes | Twilio OTP + SMS |
| **Email address** | Yes | Account management; transactional email | No (processor) | Optional | Yes | Convex / email provider |
| **Photos** | Yes | App functionality (profile photo, group/event covers, chat images) | No (processor: Cloudflare R2) | Optional | Yes | expo-image-picker → R2 |
| **Voice / audio (user content)** | Yes | App functionality (voice messages in chat) | No (processor: R2) | Optional | Yes | expo-av / RECORD_AUDIO |
| **Approximate location** | Yes | App functionality (discover nearby groups, distance sort) | No | Optional | No | ACCESS_COARSE_LOCATION. Device GPS is cached locally (AsyncStorage, 30-min TTL) and NOT sent to the backend; only group/event coordinates are sent to map tile servers. |
| **Precise location** | Yes | App functionality (center the Explore/nearby map) | No | Optional | No | ACCESS_FINE_LOCATION; foreground only, not background-tracked. Same local-only handling as above. |
| **Contacts** | **No** (do not declare) | — | — | — | — | expo-contacts is installed as a config plugin (so the contacts permission appears in the manifest) but has **zero runtime usage** — no contacts are read. Declare NOT collected, and ideally strip the permission (see §6). |
| **Calendar** | **No** (do not declare) | — | — | — | — | expo-calendar is a config plugin only — **no calendar read/write happens**; event reminders are push-only. Declare NOT collected, and ideally strip the permission (see §6). |
| **Messages / other user-generated content** | Yes | App functionality (group chat, DMs, prayer requests, polls) | No (processor: Convex/R2) | Optional | Yes | Convex messaging |
| **App interactions / in-app activity** | Yes | Analytics; app functionality | No (processor: PostHog) | Optional | Yes | posthog-react-native |
| **Crash logs** | Yes | App functionality / diagnostics | No (processor: Sentry) | Required | Yes (may include user/session id) | @sentry/react-native |
| **Diagnostics / performance** | Yes | Diagnostics | No (processor: Sentry/PostHog) | Required | Maybe | Performance + error data |
| **Device or other IDs (push token)** | Yes | App functionality (push notifications); messaging | No (processor: Expo Push) | Optional | Yes | expo-notifications token |

Data NOT collected (declare "No"): financial info, health/fitness, web browsing
history, SMS/call logs (the app reads neither — it only sends SMS via Twilio
server-side), and installed-apps inventory.

> Caveat on **Photos/audio/messages "Linked to identity"**: these are tied to the
> authenticated account, so "Yes." Anonymous prayer posts are still linked to an
> account internally even when displayed anonymously — declare "Yes."

---

## 3. Content Rating Questionnaire (IARC)

Togather is a category-based questionnaire (Google's "Social / Communication" path).
Draft answers:

| Question | Answer | Why |
| --- | --- | --- |
| Does the app contain or allow **user-generated content**? | **Yes** | Group chat, DMs, prayer requests, photos, voice messages, polls |
| Does it allow **users to communicate / interact** (chat, messaging)? | **Yes** | Real-time channels and direct messages |
| Can users **share their location** with others? | **No** (clarify) | Location is used only to find nearby groups on the user's own map; it is not broadcast to other users. If any feature exposes a user's location to others, answer **Yes**. (VERIFY) |
| Can users **share personal info** publicly? | Limited | Profile name/photo are visible to community members; declare per IARC prompt as user profiles |
| Does it contain **violence, sexual content, profanity, gambling, drugs**? | **No** | No such content is part of the app; a profanity filter (`utils/profanityFilter.ts`) is applied to UGC |
| Does it have **moderation / reporting** for UGC? | **Yes** | In-app blocking, reporting, and sensitive-content flagging (`messaging/blocking.ts`, `notifications/moderation.ts`) |
| Does it provide **unrestricted internet access / web browsing**? | **No** | Only links shared by members open in the system browser |
| Does it facilitate **purchases of real goods/services**? | **No** | Community billing is handled off-app with admins, not via in-app purchase |

**Likely resulting rating:** Low/teen-level due to the presence of user-to-user
communication and UGC, even though the content itself is benign.
- **ESRB:** Teen (the "Users Interact" / UGC interactive elements push it up from
  Everyone)
- **PEGI:** 3 with the "interactive elements: users interact" descriptor, or PEGI 12
  depending on how Google maps the UGC answer
- **Google Play content rating:** expect **Teen** ("Rated for 13+") driven by the
  social/communication features, not by objectionable content.

**Play UGC policy reminder:** Because the app has user-generated content and user-to-
user messaging, Google requires a content-moderation system, a reporting/blocking
mechanism, and the ability to remove objectionable users/content. Togather has all
three (blocking, reporting, profanity filter, moderation backend) — be ready to
describe them if Google asks.

---

## 4. Category Rationale

- **Social** is the best fit: the core loop is people joining communities, messaging in
  groups and DMs, RSVPing to events, and praying together — all social/communication.
- **Lifestyle** is a defensible alternate (faith/community management) but undersells
  the messaging core and competes in a weaker discovery pool.
- Recommendation: **Social** primary.

---

## 5. Permissions Justification (for Play's permissions declaration)

One line per sensitive permission, mapping to the in-app feature that needs it. Many of
the listed permissions are auto-added by Expo/libraries; declare only the
runtime-sensitive ones and let the rest be standard.

| Permission | Justification |
| --- | --- |
| `CAMERA` | Take a profile photo and capture photos to share in group chat. |
| `READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO` / `READ_EXTERNAL_STORAGE` | Select existing photos for profile, group/event cover images, and chat. |
| `READ_MEDIA_VISUAL_USER_SELECTED` | Support Android's selected-photos-only access for the image picker. |
| `WRITE_EXTERNAL_STORAGE` / `READ_MEDIA_AUDIO` | Save images members download from chat; access selected audio. |
| `RECORD_AUDIO` / `MODIFY_AUDIO_SETTINGS` | Record voice messages to send in group chat. |
| `ACCESS_COARSE_LOCATION` | Find and show community groups near the user on the Explore map. |
| `ACCESS_FINE_LOCATION` | Center the nearby-groups map on the user's location (foreground only; no background tracking). |
| `READ_CONTACTS` / `WRITE_CONTACTS` | **No active feature uses this** — added by the `expo-contacts` config plugin but never called at runtime. **Strip the plugin** rather than justify it (declaring an unused sensitive permission risks rejection). (REMOVE) |
| `READ_CALENDAR` / `WRITE_CALENDAR` | **No active feature uses this** — added by the `expo-calendar` config plugin but never called; reminders are push-only. **Strip the plugin.** (REMOVE) |
| `POST_NOTIFICATIONS` | Deliver push notifications for messages, event invites, RSVPs, and reminders. |
| `RECEIVE_BOOT_COMPLETED` / `WAKE_LOCK` / `VIBRATE` | Required by push-notification delivery (Expo/FCM). |
| `USE_BIOMETRIC` / `USE_FINGERPRINT` | Optional biometric unlock for the app session. |
| `ACTIVITY_RECOGNITION` | Auto-added by a location dependency; not used for a user feature — consider removing if unused. (REVIEW) |
| `SYSTEM_ALERT_WINDOW` | Auto-added by a dependency; review whether it can be stripped. (REVIEW) |
| `INTERNET` / `ACCESS_NETWORK_STATE` / `ACCESS_WIFI_STATE` | Normal network access for the real-time backend. |

> The long list of OEM launcher / badge permissions in the merged manifest
> (`com.oppo.*`, `com.huawei.*`, `me.everything.badger.*`, etc.) is added automatically
> by the notification/badge library for app-icon badge counts. They are not sensitive
> and need no Play declaration.

---

## 6. Open Items for the User (need input or verification)

**✅ Resolved during prep:**
- **Account/data deletion** — exists in-app (Settings → Delete Account). Data Safety
  "deletion method" requirement satisfied; declare the in-app path.
- **Unused contacts/calendar permissions** — `expo-contacts`/`expo-calendar` have **zero
  runtime usage** (verified: no `.ts/.tsx` imports). Their permissions are now stripped
  via `android.blockedPermissions` in `app.config.js`, so the manifest won't declare
  `READ/WRITE_CONTACTS` or `READ/WRITE_CALENDAR`. Declare Contacts/Calendar "not
  collected."
- **`SYSTEM_ALERT_WINDOW`** — leaked from RN's debug manifest; now blocked. Legacy
  storage perms also blocked.

**Still needs your input / a decision:**
1. **Legal pages are client-rendered only** — `https://togather.nyc/legal/privacy` and
   `/legal/terms` return HTTP 200 but the raw HTML contains no policy text (rendered by
   JS via the SPA fallback). Google's crawler usually runs JS, but consider pre-rendering
   a static fallback for these two routes before submitting.
2. **Location sharing between users** — verified one-way (device GPS is cached locally
   for the nearby-groups map and not sent to other users), so the IARC "share location"
   answer is **No**. Flip only if a future feature exposes a user's location to others.
3. **Fully remove vs keep contacts/calendar deps** — permissions are already stripped,
   but the `expo-contacts`/`expo-calendar` npm deps + plugins remain. Decide: (a) leave
   as-is (harmless now), (b) remove the deps/plugins entirely for cleanliness, or (c)
   these are planned features to wire up later. No action needed for launch.
4. **App name** — `Togather: Community & Groups` (28 chars) vs plain `Togather`. Confirm
   branding preference (note: prod bundle id is `app.gatherful.mobile` — is a "Gatherful"
   rebrand in play for the public name?).
5. **Support email** — used `togather@supa.media` (the address in the app's legal pages).
   Switch to a dedicated support inbox if one exists.
```
