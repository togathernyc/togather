# Church Migration UI Redesign — Product Brief

**Goal:** make Togather feel instantly familiar to churches migrating from WhatsApp
Communities, while keeping every Togather superpower (group finder, events, prayer,
bots, channels, rostering) one tap away.

**Companion wireframes:** [`wireframes.html`](./wireframes.html) — 19 annotated
screens (14 mobile, 5 web). Open in a browser.
**Companion feature map:** [`FEATURE-MAP.md`](./FEATURE-MAP.md) — exhaustive
audit of every existing surface (group settings, leader tools, admin, People
CRM/health, rostering/serving/tasks, notifications, settings, public links) and
its new home, plus the cross-cutting gaps the audit surfaced.

---

## 1. Context & problem

Most small-to-mid churches run their community on **WhatsApp Communities** today:
a community with a broadcast-only **Announcements** channel, a set of member
groups ("Groups you're in" / "Groups you can join"), and familiar chat threads
(reactions, replies, @mentions, voice notes, link previews).

Togather's *data model already mirrors this almost 1:1* — community → groups →
channels, announcement groups (ADR-008), leaders channels, invite links,
phone-first OTP auth — and the chat layer is already explicitly WhatsApp-inspired
(`ChatInboxScreen.tsx` collapsing header, `AttachmentPanel.tsx`,
voice notes/waveforms, image grids). **But the IA hides the resemblance:**

- The first tab is a map-first **Groups/Explore** screen (`(tabs)/search.tsx`), not chats.
- Group → channel nesting renders as indented inbox sub-rows, not the
  Community → Announcements → Groups hierarchy migrating members know.
- Six tabs (Groups · Events · Inbox · Prayer · Admin · Profile) vs WhatsApp's
  simple Chats-centric shell.
- **Zero migration tooling:** no member import, no invite kit or QR codes, no
  WhatsApp bridge. The only WhatsApp-related feature (`externalChat.ts`) sends
  members *back to WhatsApp*.

The redesign closes the gap in three moves: a familiar shell, progressive
superpowers, and a migration on-ramp.

## 2. Personas

| Persona | Job to be done | Fear |
|---|---|---|
| **Pastor / church admin** ("decision maker") | Move the whole church off WhatsApp without losing anyone | "Half my members won't make the jump; I'll run two systems forever" |
| **Member** (the 80%) | Keep chatting with their groups like nothing changed | "Another app to learn" |
| **Group leader** | Run their group: announcements, events, follow-ups | "More admin work" |

## 3. North star & principles

> **A WhatsApp member should be able to use Togather for a week without learning
> anything new — and then discover the superpowers.**

1. **Familiar shell.** The home experience mirrors WhatsApp's Chats + Community
   hierarchy: same anchors, same gestures, same visual rhythm. Togather's default
   primary is already green (`#1E8449`); lean into it.
2. **Superpowers, progressively disclosed.** The map-based group finder, events
   with RSVP, prayer, bots, polls, and rostering surface *inside* familiar
   surfaces (rows in the Community hub, cards in chat) — never as a foreign
   first impression.
3. **Migration is a product, not a doc.** An admin should be able to mirror their
   WhatsApp community, pre-import members, and hand out an invite kit in one
   sitting — with a bridge back to WhatsApp during the transition weeks.

## 4. Familiarity anchors (from WhatsApp Communities screenshots)

Inventory of the muscle memory we must preserve, taken from real usage
screenshots of a church-adjacent community ("Peak and Pace", "LICG"):

1. **Chats-first home** — large "Chats" title, search bar, Archived row,
   community rows with stacked-card avatars, unread count badges, per-row
   timestamps, muted-bell icons.
2. **Community page** — community header card, **Announcements** channel row on
   top, then **"Groups you're in"**, then **"Groups you can join"** with member
   counts, and an **"+ Add group"** CTA.
3. **Broadcast announcements** — announcement thread with day pills, rich
   announcements (📅 date, 📍 place, 🎟 link), footer note *"You can reply to
   announcements, but only community admins can send them."*
4. **Chat thread anatomy** — per-sender colored names, reply/reaction bubbles,
   @mentions, link preview cards, "Edited" labels, day dividers, green outgoing
   bubbles, read receipts, composer with `+` / sticker / camera / mic.
5. **New chat sheet** — one `+` entry: New group / New contact / New community /
   New broadcast, then frequently contacted.
6. **"You" tab** — profile card up top, then stacked settings groups
   (Broadcast messages, Lists, Starred, Linked devices → Account, Privacy,
   Notifications, Invite a friend).
7. **Chat themes** — per-chat wallpaper + bubble color → maps to Togather's
   per-community branding (primary/secondary color already exists in admin
   Settings).

## 5. Mobile IA redesign

### Tabs: 6 → 4, chats first

| # | Current | Proposed | Notes |
|---|---|---|---|
| 1 | Groups (map Explore) | **Chats** | Inbox becomes home, renamed. WhatsApp's anchor surface. |
| 2 | Events | **Events** | Unchanged feature, moved up. |
| 3 | Inbox | **Prayer** | Still gated on `churchFeatures.prayerEnabled`. |
| 4 | Prayer | **You** | Profile renamed; admin entry moves into You + the community page. |
| 5 | Admin | — | Tab removed. |
| 6 | Profile | — | Tab removed; serving-mode tab swap unchanged. |

**The community page is a pushed screen, not a tab.** WhatsApp has no
community tab — the community page opens from the chat list, and that's the
muscle memory we mirror: tapping the church's cluster row (or header) in Chats
pushes the community page (W2): Announcements, Your groups, **Groups you can
join** + "Find your group" (the full map finder one tap deeper), this-week
events, Prayer card, Admin card. A tab version would be ~70% duplication of
Chats/Events/Prayer/You; the two things that genuinely live on this page are
**discovery** and **cold start** — and cold start is solved where it actually
occurs: a brand-new member with zero groups sees the same "Groups you can
join" content as the Chats empty state.

Rationale: WhatsApp users open the app to *chat*. Discovery ("Groups you can
join") belongs on the community page, exactly where WhatsApp puts it — with
Togather's map finder one tap deeper. The Admin tab's audience is tiny; a card
on the community page + a row in You serves it without spending a tab.

### Hierarchy reconciliation — stage the superpower, don't flatten it

The two products nest in *opposite directions*, and this is the single biggest
source of migration confusion if handled naively:

```
WhatsApp:  Everything (DMs + groups + communities, one flat list)
             └── Community
                   └── Community group  (a group IS one chat thread)

Togather:  Community  (the app context: subdomain, branding, membership)
             └── Groups + DMs
                   └── Group channels  (general / leaders / announcements / custom)
```

WhatsApp's flat top level is why the screenshots show a 62-unread Chats badge
spanning weddings, family, and church. Togather's community-scoping and its
group→channel depth are the **focus and extensibility superpowers** — we keep
both, but render them through three rules:

**Rule 1 — one row = one place you talk.** The Chats list translates hierarchy
into WhatsApp-shaped rows. A single-channel group renders as a single row,
indistinguishable from a WhatsApp group (existing `GroupedInboxItem` behavior —
keep it). A multi-channel group renders as a cluster — group header row with
its main channel in the prominent spot (`selectMainChannel.ts`) — which is
*exactly* how a WhatsApp Communities row with stacked sub-chats already looks.
Members never navigate an abstract hierarchy; they tap rows.

**Rule 2 — channels are growth, not structure to learn.** A freshly migrated
group *is* one thread, like the WhatsApp group it mirrors. Channels appear in
a member's list only when a second channel becomes **visible to them**: leaders
see `leaders` because they're leaders; members see `announcements` or custom
channels only once leaders create/share them. The extensibility ladder —
group → channels → shared channels → event channels → rostering — is opt-in
per group, so a church can stay "WhatsApp-simple" forever and never see the
depth it isn't using. Migration wizard default: each mirrored WhatsApp group
gets exactly one visible channel.

**Rule 3 — community scope is a feature we sell, not hide.** Where WhatsApp
interleaves church chat with everything else in your life, opening Togather
means *you're at church* — church branding, church people, zero foreign
unreads. Onboarding and the migration handoff message should say this
explicitly ("your church gets its own app"). The multi-community switcher
parks where WhatsApp users expect account/community switching: the avatar in
the Chats header and a row in You — present, never in the way (most members
belong to one church; the flat all-communities list is WhatsApp's compromise,
not its strength).

**The fractal rule — discovery repeats at every level.** WhatsApp's community
page is an intermediary directory: Announcements, groups you're in, groups you
can join. Our community page (W2) is exactly that. One level down, **each
group gets the same page shape**: the channel directory (W17) shows *your
channels* and **channels you can join** — open-join or request-to-join per the
existing `joinMode`. This requires one small net-new primitive: a
`discoverable` toggle on custom channels (today channels are only reachable
via invite links or being added by a leader — there is no browse). A member
who learned "community page → join a group" already knows "group page → join
a channel."

**Channel hygiene — membership never equals clutter.** What happens when a
group has many channels and you're in all of them:

1. **Chats is a recency surface, never a directory.** A group cluster shows
   the main channel (existing `selectMainChannel` logic) plus at most **two**
   sub-rows with unread/recent activity; everything else collapses behind an
   "N more channels" row. Being in 12 channels never means 12 rows.
2. **Muted channels sink.** A muted channel never expands the cluster and is
   excluded from the group's unread count (the badge becomes a quiet dot if
   only muted channels have activity). Mute-per-channel is the P0 build from
   FEATURE-MAP §2.
3. **Inactive and archived channels leave the list entirely** (the existing
   per-type active-state toggles + archive).
4. **The channel directory (W17) is the canonical "all channels" view** —
   the place you go *looking* for a channel, so Chats never has to be.
5. **Leaders get tidy-up nudges:** channels with no messages in 60 days
   surface a "quiet channels" card in the directory suggesting archive
   (suggestion only — never auto-archive).

Level-by-level mapping (also diagrammed in the wireframes):

| WhatsApp level | Togather rendering | Note |
|---|---|---|
| Chats — everything, one list | **Chats tab — everything in your church** | Same shape, tighter scope; scope is the feature |
| Community | **Your church = the whole app** + community page (pushed from Chats) | Branding, subdomain, membership |
| Community group (one thread) | **Group — one row until it grows channels** | Rule 1 + Rule 2 |
| — (no equivalent) | **Channels** within groups; shared/event channels | Extensibility superpower, leader-side opt-in |
| Many communities, interleaved | **Community switcher** (Chats header avatar + You) | Focus superpower |

**The stacked-communities workaround.** Big churches hack WhatsApp's missing
depth by creating *extra communities*: the church has its overall community,
and a large ministry (say, a 100-person worship team) spins up its **own**
WhatsApp community so its chats — "Part Leaders", "Sopranos", "Band" — can act
like channels. Members end up straddling two communities with two announcement
feeds. This maps *exactly* onto Togather's model, and the migration wizard
must treat it as a first-class case (wireframe W16):

| Church's WhatsApp reality | Togather mapping |
|---|---|
| Overall church community | The community |
| A chat in the church community | A group (one visible channel) |
| A ministry's *separate* community (worship team) | **One group with channels** |
| — its "Part Leaders" chat | The group's built-in `leaders` channel (or a custom channel if part leaders ≠ group leaders) |
| — its "Sopranos" / "Band" chats | Custom channels |
| — its announcements chat | The group's `announcements` channel |
| A chat spanning ministries (e.g. "Sunday Production" across worship + tech) | A **shared channel** across groups — structure WhatsApp cannot express at all |

Wizard step 2 therefore asks: *"Does your church use more than one WhatsApp
community?"* — each extra community becomes a group-with-channels, and the
sprawl problem (duplicate memberships, two announcement feeds to check)
becomes the migration pitch: same structure, one roof, one announcements feed.

### Screen specs (wireframes 1–9)

**W1 — Chats (home).** Keep `ChatInboxScreen`'s collapsing large-title header,
add: community row pinned first (church logo, stacked-card avatar treatment,
Announcements preview), group rows with unread badges, DMs, Message Requests
row, compose FAB. `selectMainChannel.ts` logic unchanged. Applies hierarchy
Rules 1–2: single-channel groups are plain rows; multi-channel groups render
as WhatsApp-Communities-style clusters. The header avatar is the community
switcher entry (Rule 3). This is mostly a restyle of the existing inbox, not
a rebuild.

**W2 — Community page.** The WhatsApp community-info layout as a pushed screen
(from the church row/header in Chats; also the Chats empty state for members
with no groups yet):
branded header (logo, name, member count — community `primaryColor` band),
**Announcements** row, **Your groups** (rows w/ last-message previews),
**Groups you can join** (2–3 suggestions + **"Find your group"** card with map
thumbnail → opens today's full-screen Explore w/ filters), **This week**
events strip (horizontal cards w/ RSVP state), Prayer card (session CTA),
Serving card (when rostered), Admin card (admins only: adoption stats during
migration, pending requests count).

**W3 — Announcements channel.** Existing announcement-group thread with the
WhatsApp footer convention: *"Only leaders can send announcements"* (+ optional
member replies per ADR-008 config). Event announcements render the existing
`event_link` card with inline RSVP. During migration, admin posts show an
**"Also sent to WhatsApp"** badge (see §7 bridge).

**W4 — Group chat.** No feature change — this screen already wins. Ensure:
per-sender name colors, day pills, reply preview bar, reaction bar; polls,
event cards, availability requests, and bot messages (Birthday/Welcome bot with
a small **BOT** badge) render as native cards in-thread. Composer stays
`+` / GIF / camera / mic.

**W5 — Compose sheet (`+`).** One sheet: New group chat · New channel ·
New announcement (leaders) · New event · New prayer request · Invite people
(opens invite kit). Frequently-messaged people below.

**W6 — Group finder.** Today's Explore, reframed as the superpower behind
"Groups you can join": map with pins, filter chips (Group type — dynamic per
community, Day, In person/Online, Near me), bottom-sheet cards with **Join** /
**Request to join** per `joinApprovalMode`. Unauthenticated deep-link path
(`g/[shortId]` → join-flow) unchanged.

**W7 — Events.** Existing ADR-022 structure (My events / Next up / This week /
Later), plus calendar-export row. RSVP chips (Going · Maybe · Can't) inline on
cards.

**W8 — Prayer.** Unchanged ("Prayer 1 of 3" session flow). Add a Community-hub
entry card so it's discoverable without the tab being first-run visible.

**W9 — You.** WhatsApp "You" hierarchy: profile card → **Switch community**
(existing switcher), **Invite your church** (invite kit), **Use Togather on
the web** (pairs with W10; replaces "Linked devices" mentally), Starred,
Archived groups → then Admin tools (role-gated), Notifications, Privacy
(blocked users), Help & feedback. Absorbs today's `ProfileMenu` catch-all
drawer (My events, My schedule, My prayers, Leader tools entries, Settings).

**W13 — Group info page.** The biggest consolidation: today group settings are
split across the Edit form, the group-detail GROUP ACTIONS card, and the
leader-tools subtree, with inconsistent gates. The redesign gives every group
**one WhatsApp-group-info-shaped page**: hero (photo, name, member count,
description, group-type chip) → icon action row (Invite · Share · Search) →
**Mute toggle** (promoting the per-group notification switch buried in global
Settings today — and building the per-channel mute that exists in schema but
has no UI) → Channels section (with create/reorder/shared-channel badges) →
Events → **Leader tools card** (role-gated: People/Check-in, Attendance,
Tasks, Rostering, Run sheet, Resources, Toolbar) → **Bots card** (kept
prominent — a headline superpower) → Details (schedule, location, external
link) → Settings rows with explicit `ADMIN` badges for community-admin-only
controls (`hiddenFromDiscovery`, `joinApprovalMode`, archive) → red Leave
group at bottom (WhatsApp convention). Full field-by-field mapping in
FEATURE-MAP §3–4.

**W14 — People (Check-in) list.** The member-health CRM, today hidden behind a
`href: null` tab and a Profile-menu link. New entries: Group info › Leader
tools › People (leaders, assigned-to-me default) and Community hub Admin card
("3 need attention") → full list. Keeps everything that works: triage sections
(Needs attention <40 / Watch 40–69 / Healthy ≥70), the **reason line** ("14d
since contact · missed last 3" — the score is never a mystery), Reach-out pill
(Text / Call / Log in-person), assignee line, desktop spreadsheet with saved
views + filter DSL + map view. Migration tie-in: pre-imported members appear
as **Invited** rows until first sign-in.

**W15 — Person page (unified).** Merges the three overlapping person views
(`FollowupDetailScreen`, admin `PersonDetailScreen`, profile) into one page
with role-gated sections: header (contact actions) → health card (3 score bars
+ reason line + status/snooze) → assignees (and the Followup Bot fix: bot
assignment now writes the CRM assignee of record) → log follow-up (in-person /
call / text, back-datable) → timeline (touchpoints, notes, attendance,
serving) → tasks → **Admin section** (role management, transfer primary
admin, remove — primary-admin-gated). Naming decision: leader-side stays
"Reach out"; the member-initiated `reach_out` request feature is renamed
**"Ask for help"** in UI to kill the collision.

**W17 — Channel directory.** The fractal intermediary page for a group:
*Your channels* (with mute state inline), **Channels you can join**
(`discoverable` custom channels, Join or Request per `joinMode`), archived
row, "＋ Add channel" (leader), and the leader-only **quiet-channels tidy-up
card** (hygiene rule 5). Reached from Group info › Channels and from the
"N more channels" collapse row in Chats.
**Decision:** "Channels you can join" is visible to **every group member** —
`discoverable` defaults ON for custom channels; a leader can hide an
individual channel (e.g. a sensitive care channel), and approval-required
channels expose only their existence, never their contents.

**W18 — Channel management page.** Consolidates today's 2,632-line
`ChannelInfoScreen` into the WhatsApp-info shape: hero (`#name`, member count,
shared-with badge) → **Mute** toggle → Members row → **Leader controls** card
(rename, composer hint, join mode, **discoverable** toggle, invite link with
share/QR, share with groups, active state, archive) → red Leave channel.
Per-type variants unchanged underneath (PCO sync settings, cross-team
selectors, announcement-share confirm).

**W19 — Rostering grid (desktop-first).** The scheduling superpower, kept
structurally as-is (ADR-024–027) and given the desktop treatment it deserves:
ROLES lens (rows = roles, columns = services; cells filled / awaiting /
needed) and PEOPLE lens (most-available-first — the availability→roster
bridge), Collect availability (in-chat `availability_request` cards + public
`a/[token]` link), Publish per team, run-sheet and event-tasks entries per
column. Mobile keeps the same grid (frozen first column) — unchanged from
today. Serving mode (auto-enter 12h before service; Runsheet · Inbox · Tasks ·
Exit) is untouched by the redesign.

## 6. Web redesign

The web client is the Expo web build (react-native-web) — the desktop split-pane
inbox and `DesktopSideNav` already exist; only ~4 screens are desktop-aware.

**W10 — Desktop client, WhatsApp-Web layout.** Three panes: nav rail (Chats ·
Community · Events · Prayer · Admin · You) + conversation list + thread, plus a
**right context panel** (group info: members, upcoming events, bots, shared
files) — the panel WhatsApp Web users expect, and where Togather's extras live
on desktop. Extend `useIsDesktopWeb` treatment to Community hub, Events, and
Admin screens.

**W11 — Migration wizard (admin, desktop-first).** "Move your church from
WhatsApp in an afternoon." Builds on the existing demo-community onboarding
(`onboarding/demo` 4-step wizard) and `GoLiveScreen`:

1. **Your church** — existing demo setup (name, campuses, service times, branding).
2. **Mirror your WhatsApp groups** — checklist UI: add each WhatsApp group as a
   Togather group (name + type + leaders); announcements group auto-created.
3. **Bring your people** — CSV/contacts import creating *pre-registered members*
   keyed by phone number (phone-OTP auth auto-matches them on first sign-in —
   they skip straight to "Is this you?"). Extends the existing
   `FollowupCsvImportModal` import machinery to full membership.
4. **Invite kit** — per-community and per-group: short link, **QR poster**
   (printable PDF, branded), and a pre-written WhatsApp handoff message with
   copy button. *(QR generation is net-new — nothing in the codebase does this.)*
5. **Go live & track** — existing billing conversion + the adoption dashboard.

**W12 — Adoption dashboard (admin).** Invited vs joined per group (progress
bars), overall adoption %, bridge status per group, "nudge stragglers" action
(re-send WhatsApp handoff message), migration checklist completion.

**W16 — Wizard step 2: mirror your WhatsApp structure.** First-class support
for the stacked-communities workaround (§5 hierarchy table): the admin lists
each WhatsApp community their church runs; the overall community's chats map
to groups, and each *extra* community (worship team etc.) maps to a
group-with-channels — its part-leaders chat to the `leaders` channel, section
chats to custom channels, its announcements to the group's announcements
channel. Cross-ministry chats become shared channels. The wizard renders this
as a two-column mapping the admin can adjust before anything is created.

**Admin console (desktop shell, W12's frame).** Nav: **Migration · Requests ·
People · Broadcasts · Stats · Settings** (+ staff area). Key fixes from the
audit (FEATURE-MAP §5): the fully-built but *orphaned* broadcast composer with
its two-admin approval flow gets routed again (and gains "post to
Announcements channel" as a delivery option alongside push/email);
group-creation requests gain the "approve with modifications" UI the backend
already supports; prayer reviews + chat-message flags unify into one
Moderation queue; integrations (PCO/Clearstream/Flodesk) move here from
leader-tools where they were always admin-gated anyway; duplicate-account
merge and the staff screens get real navigation instead of URL-only access.

## 7. New migration features (net-new product)

| Feature | What it is | Builds on | Phase |
|---|---|---|---|
| **Invite kit** | Short link + printable QR poster + pre-written WhatsApp handoff message, per community/group | `g/[shortId]`, `ch/[shortId]`, `c/[slug]` links exist; QR + poster generation net-new | **P0** |
| **Member pre-import** | CSV/contact import → pre-registered members auto-matched at phone sign-in | Phone-first auth, `confirm-identity` flow, CSV import machinery | **P0** |
| **WhatsApp bridge** | During transition: "Also send to WhatsApp" on announcements — share-sheet/copy handoff of the announcement text + link back to the Togather post | Inverts existing `externalChat.ts` direction; `eventBlasts` "Also sent via SMS" badge is the UI precedent | **P1** |
| **Adoption dashboard** | Invited vs joined tracking, per group | Admin Stats tab, `communityPeople` | **P1** |
| **Chat history import** | Parse WhatsApp chat export (.zip/.txt) to seed a group's history | Nothing — heavy lift, fidelity/privacy questions | **P2 (explore)** |

## 8. Phasing

- **P0 — Familiar shell + invite on-ramp:** tab reorder/rename (Chats first,
  Community hub, You), Community hub screen, Chats-home restyle, **Group info
  page consolidation (W13)**, **Mute UI** (per-group promotion + per-channel
  build — the highest-frequency WhatsApp gesture, currently schema-only),
  invite kit (QR + handoff message), member pre-import. *P0 is mostly
  re-composition of existing screens — the chat stack, Explore, Events,
  Prayer are feature-frozen.*
- **P1 — Migration wizard + bridge + console:** wizard steps 2–5 including the
  multi-community mapping (W16), WhatsApp bridge on announcements, adoption
  dashboard, desktop right-panel + desktop-aware Community/Events/Admin,
  admin console shell with revived Broadcasts, approve-with-modifications,
  unified Moderation queue, **unified Person page (W15)** + People entries
  un-hidden (W14), Followup-Bot-writes-assignee fix, "Ask for help" rename.
- **P2 — Deepening:** chat history import exploration, per-community chat
  themes (wallpaper), migration concierge tooling, legacy score-pipeline
  removal, on-break groups UI, admin-editable group type.

## 9. Engineering notes (grounded in current code)

- Tab changes: `apps/mobile/app/(tabs)/_layout.tsx`; serving-mode tab swap and
  desktop `DesktopSideNav` must mirror the new tab set.
- Community hub: new screen composing existing queries (announcement group,
  memberships, Explore suggestions, events sections, prayer feed count,
  admin pending counts). Route suggestion: `(tabs)/community.tsx`.
- Chats home: restyle of `ChatInboxScreen.tsx` + `GroupedInboxItem.tsx`
  (community row grouping instead of indented sub-rows).
- Invite kit: QR lib must respect native-dep safety rules
  (`native-deps.json`, gated if native; a pure-JS/SVG QR generator avoids the
  problem). Poster rendering can reuse the satori/resvg OG-image pipeline that
  already exists in `apps/web` build scripts — but server-side via a Convex
  action or the link-preview worker.
- Pre-import: extend `communityPeople` with `preRegistered` status; match in
  the existing `confirm-identity` step on phone verification.
- Bridge: no WhatsApp Business API dependency for P1 — share-sheet/copy-based
  handoff only. (API-based auto-posting is a P2 question with real cost/ToS
  implications.)
- The CLAUDE.md guides rule applies: this redesign touches Create Community,
  Branding, Groups & Channels, Events, Prayer guides — update in the same PRs,
  and add a new **"Moving from WhatsApp"** guide to `guides/registry.ts`.

## 9.5 Rollout — everything behind one flag

**Nothing leaks until we flip it.** The entire redesign ships behind a single
flag, **`whatsapp-shell`**, evaluated **per community** so pilot churches can
run the new shell while everyone else sees today's app unchanged.

- **Mechanism:** PostHog flag (already integrated) targeted by community id,
  wrapped in one hook (`useWhatsappShell()`), with the Convex `featureFlags`
  table (staff-managed, already exists — same infra as `chat-notification-collapse`)
  as a global kill-switch that overrides PostHog to off. Per-user override via
  the existing `dev/feature-flags` screen for QA.
- **Gate points** (both variants stay in the bundle; the flag only picks):
  `(tabs)/_layout.tsx` (4-tab vs current 6-tab set), `DesktopSideNav`,
  `ChatInboxScreen` (cluster rendering + community row vs current rows),
  group detail → Group info page (W13) vs current screens, `ProfileMenu` →
  You tab (W9), compose sheet, channel directory/management variants
  (W17–18). **New routes** (community page, migration wizard, invite kit,
  admin console shell, Person page) are harmless when unlinked — gate their
  *entry points*, not the routes.
- **Guarantees:** default **off**; zero copy/nav/behavior changes when off;
  no schema change alters current-shell behavior (additive fields only —
  `discoverable`, `preRegistered`, mute UI writes to existing fields);
  the kill-switch reverts instantly because both shells remain shipped.
- **Rollout order:** staff/dev overrides → pilot migrating churches
  (hand-picked, with the wizard) → all *new* communities → existing
  communities → delete the old shell + the flag (remove-don't-deprecate,
  per CLAUDE.md).
- **Serving mode, chat message features, rostering internals, Convex APIs:**
  shared between shells, not forked — the flag governs IA and screen
  composition only, which is what keeps the fork cheap enough to hold open
  for a few months.

## 10. Success metrics

- **Activation:** % of invited (pre-imported) members who sign in within 14 days
  of a church's go-live. Target ≥ 60%.
- **Familiarity proxy:** D1→D7 retention of migrated members vs current new-member
  baseline; time-to-first-message.
- **Superpower discovery:** % of migrated members who use ≥1 superpower (RSVP,
  poll vote, prayer, group finder) in first 30 days.
- **Bridge decay:** WhatsApp bridge usage per community should trend to zero by
  week 6 — the bridge is scaffolding, not a feature.

## 11. Open questions

1. ~~Tab 2 label~~ Resolved: no Community tab — the community page is a pushed
   screen from the Chats list (WhatsApp-native), and tabs are Chats · Events ·
   Prayer · You.
2. Should "Groups you can join" suggestions be admin-curated, algorithmic
   (Explore defaults), or both?
3. Announcement replies: default on (WhatsApp behavior) or off (current
   ADR-008 default) for migrated communities?
4. Does the Admin tab removal need a staff escape hatch (internal staff
   currently see it always)?
5. Chat themes (W-anchor #7): worth a P2 line, or does per-community
   primary/secondary color cover the need?
