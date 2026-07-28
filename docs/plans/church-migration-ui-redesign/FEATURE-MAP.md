# Feature Inventory → New Home Map

Companion to [`README.md`](./README.md) (the brief) and [`wireframes.html`](./wireframes.html).
This is the exhaustive audit of every existing surface and where it lives in the
WhatsApp-familiar redesign. Compiled from a full codebase sweep (tabs, inbox,
groups, channels, leader tools, admin, people/CRM, rostering, serving, tasks,
notifications, settings, auth, public links).

Legend: 🟢 stays as-is (maybe restyled) · 🔀 moves · 🆕 net-new surface · ⚠️ gap/fix required

## 1. Shell & navigation

| Today | New home | |
|---|---|---|
| `(tabs)/search` "Groups" (map Explore) | Community page (pushed from Chats church row) → "Find your group" (full Explore one tap in); also the Chats empty state | 🔀 |
| `(tabs)/events` | Events tab (position 2) | 🟢 |
| `(tabs)/chat` Inbox | **Chats tab (position 1, home)** | 🔀 |
| `(tabs)/prayer` | Prayer tab (gated, unchanged) | 🟢 |
| `(tabs)/admin` | You → Admin tools; community-page Admin card; desktop console | 🔀 |
| `(tabs)/profile` + `ProfileMenu` catch-all drawer | **You tab** (WhatsApp "You" hierarchy) | 🔀 |
| Hidden tabs `groups`/`tasks`/`people` (`href: null`) | People → Community hub card + You › Leader tools (unhidden, see §6); Tasks → You › Leader tools; groups redirect dies | ⚠️🔀 |
| Serving-mode tab swap (Runsheet · Inbox · Tasks · Exit) | Unchanged | 🟢 |
| `DesktopSideNav` + split-pane inbox | Desktop rail mirrors new 4 tabs + Admin (W10); community page opens from the chat list, as on mobile | 🔀 |
| `ProfileMenu` items: View Profile / Switch Community / My Events / My Schedule / My Prayers / Dev Dashboard / Settings / Leader Tools (Tasks · People) | All re-homed into You tab groups (W9); Switch Community also in Chats-header avatar | 🔀 |

## 2. Chats & channels

| Today | New home | |
|---|---|---|
| `ChatInboxScreen` (collapsing header, WhatsApp-style) | Chats home, restyled per W1 | 🟢 |
| `GroupedInboxItem` indented sub-rows | Cluster rows (Rule 1): plain row for single-channel groups, WhatsApp-Communities-style cluster for multi-channel | 🔀 |
| `selectMainChannel` main-spot logic | Unchanged | 🟢 |
| Message requests (`inbox/requests`) | Chats list row (W1) | 🟢 |
| Notifications synthetic row | Chats list row; feed unchanged | 🟢 |
| `inbox/new` recipient picker | "＋" compose sheet → New group chat (W5) | 🔀 |
| Channel create (`inbox/[groupId]/create`: custom / pco_services / cross_team) | Group info → Channels → ＋ (W13); same type picker | 🔀 |
| `ChannelInfoScreen` (2,632 lines: rename, hint, active state, join mode, invite link, share-with-groups, archive, leave, members, PCO sync, cross-team selectors) | Channel info page, WhatsApp-group-info shaped; Leader controls grouped under one card | 🔀 |
| Channel invite links `ch/[shortId]` (open/approval) | Unchanged; also surfaced in invite kit | 🟢 |
| Shared channels (invites, accept/decline, announcements-share confirm) | Group info → Channels section badges + channel info | 🟢 |
| Per-channel mute | ⚠️ **Schema exists (`chatChannelMembers.isMuted`), zero UI.** Build it: long-press chat row + info-page row. WhatsApp muscle memory demands Mute — P0 | ⚠️🆕 |
| Per-group notification toggle (buried in global Settings) | **Promoted to Group info page** ("Mute group") + stays in Settings | 🔀 |
| Thread replies, reactions, polls, voice, GIFs, event/task/bug/reach-out/availability cards | Unchanged in-thread | 🟢 |
| External chat link ("Join on WhatsApp") | Kept, but reframed: migration bridge UI takes over during transition; external link demoted to a group-info detail row | 🔀 |

## 3. Group settings (today split across Edit form / detail screen / leader-tools)

New home: **one Group info page (W13)**, WhatsApp-group-info shaped, with an
`ADMIN` badge on community-admin-only rows.

| Setting (today) | New home on Group info | Who |
|---|---|---|
| Photo, name, description, max capacity (`EditGroupScreen`) | Hero + "Edit group" sheet | leader+admin |
| Address fields, meeting day/time, meeting type/link | "Details" card (tap to edit) | leader+admin |
| External chat link | Details card row | leader+admin |
| `hiddenFromDiscovery` | Settings card row, `ADMIN` badge | admin only |
| `joinApprovalMode` (leaders vs admins approve) | Settings card row, `ADMIN` badge | admin only |
| Archive group | Danger zone (bottom, red) `ADMIN` badge | admin only |
| Leave group | Bottom red row (WhatsApp convention) | member |
| Share group (`g/[shortId]`) | Icon action row under hero (+ QR from invite kit) | anyone |
| Group Type | ⚠️ Read-only chip on hero; **currently uneditable post-creation — add admin-only edit** (backend supports it via request-review `modifications`) | admin |
| `isPublic`, `isOnBreak`/`breakUntil`, `reachOutConfig` | ⚠️ Schema-only, no UI today. On-break gets a Settings row (churches pause groups seasonally); rest stay backlog | ⚠️ |
| Pinned channels (`pinnedChannelSlugs`) | Channels section → reorder mode | leader |
| Requests row (leader-approval mode) | Badge on Members row | leader/admin |
| Members (add/remove/promote/demote) | Members row → roster (unchanged screens behind it) | leader/admin |
| Per-group mute (see §2) | Toggle row directly under hero action row | member |

## 4. Leader tools (the `leader-tools/**` subtree)

New home: a **"Leader tools" card on the Group info page** (role-gated, replaces
scattered entries + the deprecated `leader-tools/index` hub) and the chat
toolbar (unchanged concept, leaders can keep chips).

| Screen | New home | |
|---|---|---|
| Attendance (view/edit/chart/guests) | Group info › Leader tools › Attendance | 🟢 |
| Check-in / Followup (list + detail) | Group info › Leader tools › **People** (see §6) | 🔀 |
| Members management | Group info › Members | 🔀 |
| Tasks board + task detail | Group info › Leader tools › Tasks; community-wide board in You › Leader tools | 🟢 |
| Run sheet (+ tool settings, source PCO/native, chips) | Group info › Leader tools › Run sheet | 🟢 |
| Resources (list/editor/sections/visibility/`t/[shortId]` links) | Group info › Leader tools › Resources; member view unchanged | 🟢 |
| Bots (list + per-bot config modals) | Group info › **Bots card** (kept prominent — it's a superpower; W13) | 🟢 |
| Pin channels | Channels section reorder | 🔀 |
| Shared channels invites | Channels section badge + channel info | 🔀 |
| Toolbar settings (`leaderToolbarTools`, visibility, display names) | Group info › Leader tools › Toolbar | 🟢 |
| Events (create/edit 2,608-line screen, guests, blasts, invites) | Unchanged; entries from Group info › Events + Events tab | 🟢 |
| Integrations (PCO / Clearstream / Flodesk) | ⚠️ Community-scoped, not group-scoped — **moves to Admin console › Integrations** (it was always admin-gated) | 🔀 |
| `leader-tools/index` (deprecated redirect), `GroupLeaderToolsScreen` legacy hub w/ placeholder pages | Delete | ⚠️ |
| Rostering subtree (grid, teams, cross-team, availability, event editor, run-sheet editor, songs, templates, tasks) | Unchanged internally; entry from Group info › Leader tools › Rostering + serving mode | 🟢 |
| My Schedule / My Availability / assignment deep links | You › My schedule; serving mode unchanged | 🟢 |

## 5. Admin console

Mobile entry: You › Admin tools + Community hub Admin card. Desktop: full
console (W12 shell). Tabs: **Migration · Requests · People · Broadcasts ·
Stats · Settings** (+ staff Dashboard).

| Today | New home | |
|---|---|---|
| Requests tab (join + creation, accept/decline w/ reason) | Requests | 🟢 |
| ⚠️ Approve-with-modifications (server-supported, **no UI**) | Requests › creation review sheet gains "Edit before approving" | ⚠️🆕 |
| People tab (embedded FollowupDesktopTable/MobileCards) | People (console) — same components as §6 | 🟢 |
| Stats (active/new members, attendance by type, drill-down, CSV export sheet) | Stats | 🟢 |
| Settings: basic info, subdomain, logo, address, brand colors, explore defaults, church features (prayer/eventTasks), group types, billing, danger zone | Settings (unchanged fields) + **Chat theme** (P2, per-community wallpaper/bubble mapping) | 🟢 |
| Quick links (CWE, landing page, prayer reviews) | Proper nav rows, not "quick links" | 🔀 |
| Community-wide events screen | Console › Events section | 🔀 |
| Landing page editor (1,570 lines: fields, custom slots, auto-reply SMS, automation rules) | Console › Landing page | 🟢 |
| ⚠️ Broadcasts (`NotificationsContent` + composer + 2-admin approval — **fully built, orphaned, unrouted**) | **Revived as Console › Broadcasts**; composer also reachable from "＋ New announcement" for admins; add "post to Announcements channel" as a delivery channel (today: push/email only, no chat post) | ⚠️🔀 |
| Prayer reviews queue | Console › Moderation | 🔀 |
| ⚠️ Chat message moderation (**no queue exists**; `chatMessageFlags` schema only) | Console › Moderation — unified queue (prayer + chat flags + reported users) — P1 | ⚠️🆕 |
| Person admin view (`admin/person/[user_id]`: roles, transfer primary, remove) | **Merged into the unified Person page** (§6) with an Admin section — kills the third person-view | 🔀 |
| Duplicate accounts merge | Console › People › overflow | 🔀 |
| Integrations (from leader-tools) | Console › Integrations | 🔀 |
| Developer API keys | Console › Settings › Developer | 🟢 |
| Slack service bot config + activity | Console › Integrations › Slack bot | 🔀 |
| Staff-only: super-admin Dashboard, feature flags, maintainers, posters, bugs | Console › Staff area (unchanged, properly routed — today several are URL-only or linked from a dead legacy screen) | ⚠️🔀 |
| Orphans to delete: `AdminDashboardScreen` (dead tiles), `PendingRequestsScreen` | Delete | ⚠️ |
| Roles model (member/moderator/admin/primary-admin, staff flags, platform roles) | Unchanged; UI copy in Person page Admin section | 🟢 |

## 6. People CRM & health ("Check-in")

Naming decision: user-facing **People** (the roster) and **Check-in** (the
health workflow); code's "followup" naming stays internal. New homes:
- **Leaders:** Group info › Leader tools › People (their groups), assigned-to-me
  default view.
- **Admins:** Community hub Admin card ("3 need attention") + Console › People.
- The hidden `(tabs)/people` route is retired in favor of these entries.

| Today | New home | |
|---|---|---|
| Triage cards (Needs attention / Watch / Healthy, reason lines) | People list, mobile (W14) | 🟢 |
| Desktop spreadsheet (columns, saved views, filter DSL, map view, quick-add, bulk assign) | People list, desktop/console | 🟢 |
| Scores: Serving / Attendance / Connection + bands + breakdown modal | Person page + list strips (W15); "reason line" is sacred — keep | 🟢 |
| FollowupDetailScreen (log in-person/call/text, back-date, notes, snooze, assign, attendance edit, serving history, timeline, tasks) | **Unified Person page** (W15) | 🔀 |
| `PersonDetailScreen` (admin: roles, activity, remove) | Merged into unified Person page, Admin section (role-gated) | 🔀 |
| Reach-out sheet (Text / Call / Log in-person) | Person page + list card pill (unchanged) | 🟢 |
| Member "reach out" requests (`reach_out` channels, cards, resolve flow) | ⚠️ Naming collision with leader reach-outs — member-facing feature renamed **"Ask for help"** in UI; leader side keeps "Reach out" | ⚠️🔀 |
| Followup Bot (round-robin leader @mention) | ⚠️ **Bot must also write `communityPeople.assigneeIds`** so bot assignment = CRM assignment of record | ⚠️ |
| CSV import (preview/apply, header aliasing) + quick-add | People list › Import; **shared machinery with migration pre-import (brief §7)** — one importer, two entry points | 🔀 |
| CSV export | People list › Export | 🟢 |
| Score config / columns / alerts / custom fields (FollowupSettingsPanel) | People list › settings gear | 🟢 |
| Auto-archive (60d) + pre-archive notices | Unchanged; surfaced as "Inactive" filter chip | 🟢 |
| ⚠️ Dual score pipelines (`memberFollowupScores` legacy + `communityPeople`) both running | Engineering cleanup during redesign: finish migration, delete legacy | ⚠️ |
| Migration tie-in | 🆕 Pre-imported members appear as **"Invited"** rows (status before first sign-in); adoption dashboard (W12) reads the same table | 🆕 |

## 7. Events, prayer, notifications, settings

| Today | New home | |
|---|---|---|
| Events tab structure (ADR-022), create/edit, RSVP funnel, blasts, CWE, series, guests | Unchanged (W7) | 🟢 |
| Prayer (session flow, my-prayers, prayed-for, reactions, crisis card, digests) | Unchanged (W8) + Community-hub card | 🟢 |
| Notification feed + per-group toggles + prayer prefs + soft-ask flows | You › Notifications; mute promoted per §2 | 🔀 |
| Settings screen sections (profile, timezone, appearance, notifications, leader tools, blocked, delete account) | You tab groups (W9) | 🔀 |
| Edit profile, user profiles, badges, mutual groups | Unchanged behind You / avatars | 🟢 |
| Auth funnel (phone OTP, confirm-identity, claim-account, select-community, join-flow) | Unchanged; pre-import matching hooks into confirm-identity | 🟢 |
| Public links (`c/[slug]`, `g/`, `ch/`, `e/`, `t/`, `a/`, nearme) | Unchanged; invite kit generates QR wrappers for them | 🟢 |
| Onboarding (demo → go-live → billing) | Wrapped by migration wizard (W11) | 🔀 |
| Dev screens, ui-test, theme gallery | Unchanged (dev-only) | 🟢 |

## 8. Cross-cutting fixes surfaced by this audit

1. **Mute has no UI** — highest-frequency WhatsApp gesture; P0 (§2).
2. **Broadcast composer + approval flow is orphaned** — route it (§5).
3. **People tab is hidden** — give People real entries (§6).
4. **Three person views** → one Person page with role-gated sections (§6).
5. **Approve-with-modifications** — backend-only; add UI (§5).
6. **Followup Bot doesn't set CRM assignee** (§6).
7. **"Reach out" naming collision** (§6).
8. **Group Type uneditable post-creation** (§3).
9. **Dual score pipelines** running in parallel (§6).
10. **Dead screens to delete**: `AdminDashboardScreen`, `PendingRequestsScreen`, `LeaderToolsScreen` hub, legacy `GroupOptionsModal` path (§4, §5).
11. **No chat-message moderation queue** despite flags schema (§5).
12. **Stale docs**: `docs/features/admin.md`, `docs/features/leader-tools.md`, CheckIn guide's phantom `features/check-in` path — fix alongside.
13. **Route moves must update** `+native-intent.ts`, `KNOWN_APP_ROUTES` in the link-preview worker, and `app/__tests__/routing-conflicts.test.ts`.
