# Church Migration UI Redesign — Product Brief

**Goal:** make Togather feel instantly familiar to churches migrating from WhatsApp
Communities, while keeping every Togather superpower (group finder, events, prayer,
bots, channels, rostering) one tap away.

**Companion wireframes:** [`wireframes.html`](./wireframes.html) — 12 annotated
screens (9 mobile, 3 web). Open in a browser.

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

### Tabs: 6 → 5, chats first

| # | Current | Proposed | Notes |
|---|---|---|---|
| 1 | Groups (map Explore) | **Chats** | Inbox becomes home, renamed. WhatsApp's anchor surface. |
| 2 | Events | **Community** | New hub = WhatsApp "community info" page, alive. Explore folds in here. |
| 3 | Inbox | **Events** | Unchanged feature, moved. |
| 4 | Prayer | **Prayer** | Still gated on `churchFeatures.prayerEnabled`. |
| 5 | Admin | **You** | Profile renamed; admin entry moves into You + Community hub. |
| 6 | Profile | — | Tab removed; serving-mode tab swap unchanged. |

Rationale: WhatsApp users open the app to *chat*. Discovery ("Groups you can
join") belongs on the community page, exactly where WhatsApp puts it — with
Togather's map finder one tap deeper. The Admin tab's audience is tiny; a card
in Community + a row in You serves it without spending a tab.

### Screen specs (wireframes 1–9)

**W1 — Chats (home).** Keep `ChatInboxScreen`'s collapsing large-title header,
add: community row pinned first (church logo, stacked-card avatar treatment,
Announcements preview), group rows with unread badges, DMs, Message Requests
row, compose FAB. `selectMainChannel.ts` logic unchanged. This is mostly a
restyle of the existing inbox, not a rebuild.

**W2 — Community hub.** The WhatsApp community-info layout, made a living tab:
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
(blocked users), Help & feedback.

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
  Community hub, You), Community hub screen, Chats-home restyle, invite kit
  (QR + handoff message), member pre-import. *P0 is mostly re-composition of
  existing screens — the chat stack, Explore, Events, Prayer are feature-frozen.*
- **P1 — Migration wizard + bridge:** wizard steps 2–5 wrapping existing
  onboarding, WhatsApp bridge on announcements, adoption dashboard, desktop
  right-panel + desktop-aware Community/Events/Admin.
- **P2 — Deepening:** chat history import exploration, per-community chat
  themes (wallpaper), migration concierge tooling.

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

1. Tab 2: "Community" vs the church's own name as the tab label (branding pull
   vs consistency)?
2. Should "Groups you can join" suggestions be admin-curated, algorithmic
   (Explore defaults), or both?
3. Announcement replies: default on (WhatsApp behavior) or off (current
   ADR-008 default) for migrated communities?
4. Does the Admin tab removal need a staff escape hatch (internal staff
   currently see it always)?
5. Chat themes (W-anchor #7): worth a P2 line, or does per-community
   primary/secondary color cover the need?
