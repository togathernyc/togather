# WhatsApp Pixel-Parity: Visual Delta Lists (2026-07-29)

Produced by **side-by-side comparison** of 10 owner-supplied WhatsApp iOS reference
screenshots against the current flag-on Togather app rendered on Expo web
(390×844, seeded Demo Community, `whatsapp-shell-on` Convex flag confirmed ON).
This supersedes spec-derived styling: where WHATSAPP-DESIGN-SYSTEM.md disagrees
with these observations, **the screenshots win** and the doc must be updated.

Reference set (owner, 2026-07-29): current WhatsApp iOS — the **iOS 26 design
language**: floating circular nav buttons over content (no opaque nav bars),
floating pill tab bar, ~24px-radius inset cards. This is the target chrome.

Togather captures: `.playwright-mcp/tg-01…tg-08` (regenerate via Playwright at
390×844; login 2025550123/000000).

---

## Cross-cutting systems (fix once in the kit, inherit everywhere)

### S1. Navigation chrome
1. **No opaque nav bars on any WA screen.** Top-level screens: floating white
   **circular** buttons (44px, subtle shadow) over the scrolling content —
   e.g. Chats: ⋯ circle top-left; camera circle + solid-green ⊕ circle
   top-right. Sub-screens: floating white circle back button (chevron, black)
   — on chat rooms the circle contains **chevron + total unread count**
   ("< 62"). Togather today: opaque white bars with hairline, plain chevron,
   inline buttons.
2. Large titles: ~34pt heavy, left, below the floating-button row (Chats).
   Sub-screens use a **centered** 17pt semibold title (Community info, New
   chat) with no bar fill — title floats over grouped-gray background.
3. You tab has **no large title at all** (Togather shows "You" — remove;
   WA shows only floating buttons + centered avatar hero).

### S2. Tab bar
1. WA tab bar is a **floating rounded island** inset from screen edges with a
   soft shadow, not an edge-to-edge opaque bar.
2. Icons: thin-line ~24px glyphs, **neutral black/dark-gray** — the active tab
   gets a **highlight pill wrapped around icon+label**, NOT a green tint.
   Togather's green filled active icon + green label is the single loudest
   "not WhatsApp" signal on every screen. Labels ~10pt, black.
3. Unread badge rides the icon corner (green capsule, white 12pt text).
4. You tab shows the **user's avatar photo** as its icon.
5. Order flag-on: Chats first is already correct; Events/Prayer/You keep the
   same island styling.

### S3. Grouped inset cards (info/settings surfaces)
1. Corner radius ~**24px** (Togather ~12 — visibly wrong at a glance).
2. Row height ~52–56px (Togather ~44 — too dense). Left icon: **black**
   1.5px-stroke 24px glyph (Togather: thin gray). Label 17pt regular.
3. Chevron: gray, **vertically centered** (Togather renders chevrons hugging
   the row's top-right corner — misaligned on every card).
4. Separators inset to the label start (after icon), not full-bleed.
5. Section labels: WA info screens mostly have **no** uppercase section labels;
   where sections exist on landing screens the header is large (~20pt)
   sentence-case gray ("Groups you're in"). Togather's 12pt ALL-CAPS labels
   ("MEMBERS", "LEADER TOOLS", "GROUPS YOU'RE IN") read as iOS-15, not WA.
6. Green **text** action rows (17pt, green, no icon) and red destructive rows;
   gray left-aligned footer metadata ("Created by … Created Jul 27, 2024.").

### S4. Chat surface (bubbles + wallpaper) — LARGEST GAP
Flag-on chat rooms today LOOK like the flag-off Slack-style rows, but the WA
branch actually renders — invisibly. Root cause (verified 2026-07-29):
`MessageList.tsx` paints its container `themeColors.surface` (white)
unconditionally (~line 650, also loading/empty branches ~633/640), covering
the `chatWallpaper` tint `ConvexChatRoomScreen` applies — so white bubbles,
white day pills, and in-bubble gray timestamps all vanish against white.
Wave 3's in-code comment records MessageList's container as out of its touch
list. Fix the container, then close the fidelity gaps. Target:
1. **Wallpaper**: cream (#F6F1E9-area) with the line-art doodle pattern at low
   opacity — bundle a static wallpaper asset (PNG, `require()`, plus dark
   variant), NOT a flat tint. Applied to the whole thread area and under the
   translucent nav/composer.
2. **Bubbles**: incoming white / outgoing pale green (#D9FDD3), radius ~18px
   with the small tail on first-of-group, max-width ~75%, 16pt body.
   Sender name inside bubble top (15pt semibold, per-sender accent color),
   timestamp 11pt gray **inside** bottom-right (+ blue double-ticks outgoing).
   Consecutive same-sender messages group (tail + name only on first).
3. **Day pills**: floating white capsules ("Fri, Jul 17"), 13pt, centered.
4. Reactions: white capsule overlapping the bubble's bottom corner.
5. Mentions green; links green underlined; link previews as gray rounded
   block inside the bubble.
6. **Composer**: sits over wallpaper (translucent light bar, no hairline):
   plain ⊕ glyph left (no circle), white fully-rounded field with sticker
   glyph right-inside, camera + mic glyphs right — all ~24px dark-gray line
   icons. Togather is close structurally but: gray opaque bar, field radius
   too small, no sticker icon, glyph weights off.
7. Announcement channels: centered 13pt footer over wallpaper ("You can reply
   to announcements, but only community admins can send them.") with green
   bold keywords.

### S5. Color discipline
1. Green appears ONLY at: primary CTA pill (one per screen max — "Add group"),
   unread badges + unread timestamps, action-link text rows, outgoing bubble
   fill, selected-segment accents. Everything else is black/gray/white.
2. Kill list found on current screens: green active tab tint (S2), green
   filled channel chip in chat room header, **red "Teams" group-type chip**
   (colored chip — banned by §7), green bare icon-buttons on Events header,
   all-green fallback avatars everywhere (WA fallback avatars are muted
   pastel per-entity hues, not brand green), green circle Invite/Search
   glyphs on community page (WA uses white button cards).

### S6. Row anatomy & density (lists)
1. Chat rows: avatar **~58px** (Togather ~44 — biggest density delta), title
   17pt semibold, subtitle 15pt gray up to 2 lines, row ~78px, separator
   inset to text column.
2. Timestamp top-right 15pt — green when unread, gray otherwise ✓(already).
3. Unread badge: green capsule; community rows put a **chevron inside the
   badge** ("7 ›").
4. **Squircle avatars** (continuous-corner rounded square) for community-level
   entities; circles for people/groups. Togather uses circles everywhere.
5. Search pill: ~44px tall fully-rounded (Togather ~36 — too thin).

### S7. Typography scale (SF Pro / -apple-system throughout)
34 heavy (large title) · 28 bold (hero name) · 22 bold (screen header block) ·
~20 semibold gray (landing section headers) · 17 semibold (row titles) /
17 regular (cell labels) · 16 (bubble body) · 15 (subtitles) · 13 (footers,
day pills) · 11 (in-bubble timestamps). Audit every flag-on surface against
this; Togather is generally 1–2pt small and one weight light.

---

## Per-screen deltas

### 1. Chats list (WA ref 1 vs tg-01)
1. Header: replace inline title-row buttons with WA anatomy — floating ⋯
   circle left; camera circle + green ⊕ circle right; "Chats" large title on
   its own line below (S1). Community (DC) avatar button moves into the ⋯
   position or stays as an intentional divergence — but styled as a floating
   white circle, not a green avatar chip beside the title.
2. Search pill: 44px tall (S6.5).
3. Rows: S6 metrics (58px avatars, 17/15pt, ~78px rows).
4. Community/announcement header rows: squircle avatars + chevron-in-badge.
5. Channel sub-rows ("#" rows, "3 more channels"): intentional divergence —
   keep, but adopt WA row heights/typography; "#" avatar discs should be
   neutral gray, not tinted.
6. Timestamps: adopt WA relative format ("Yesterday", weekday, then n/n/nn"
   dates) instead of "4d"/"Jul 3".
7. Tab bar → S2.

### 2. Chat room (WA refs 3+8 vs tg-02/tg-07)
1. Entire S4 chat surface (wallpaper, bubbles, day pills, composer).
2. Nav: floating back-with-count circle; avatar+title cluster (title 17
   semibold + subtitle 13 gray e.g. "62 members"); translucent bar over
   wallpaper. Remove red type chip (S5.2).
3. Channel tab strip (General/Leaders/…): intentional divergence — restyle
   neutral (dark-on-light pills, white active pill like WA segmented, or
   underline) — NO green fill.
4. Leader tool pills (Attendance/Run Sheet/Tasks): intentional divergence —
   keep as pills (§7-legal) but neutral white/gray, and consider collapsing
   to one row height.

### 3. Group/Channel info (WA refs 4+5 vs tg-03)
1. Remove opaque nav bar → floating back circle + centered floating title (S1).
2. Hero: real squircle/circle avatar 100px, name 28pt bold; subtitle 15 gray.
   (Channel info's pale-green glyph disc → neutral entity avatar.)
3. Action-button row (white rounded cards w/ green glyph + label) where
   actions exist (Invite / Search / Mute).
4. All cards → S3 anatomy (24px radius, 52px rows, black icons, centered
   chevrons, no ALL-CAPS labels).
5. Member rows: role as right-aligned gray text ("Group Admin"), not subtitle.
6. Destructive red rows + gray footer metadata at bottom (S3.6).

### 4. You tab (WA refs 6+7 vs tg-04)
1. Remove "You" large title; floating search circle left, floating pill
   (QR + edit) right (S1.3).
2. Centered hero: avatar 100px + name 28pt (+ status bubble affordance if we
   have status; else omit).
3. First card starts BELOW hero; "Switch community/Invite" etc. keep as rows
   in S3 cards; Leader tools section keeps rows but loses ALL-CAPS label
   (use plain card grouping; if a label is needed, WA-style none).
4. All S3 card anatomy.

### 5. Community page (WA refs 2+10 vs tg-05)
The current screen mixes WA's community-info anatomy (centered hero,
segmented control) into what should be WA's community **landing**:
1. Header: floating back circle (with unread count) left, ⋯ circle right;
   left-aligned header block — squircle avatar ~56px + name 22pt bold +
   "Community" 15 gray.
2. Announcements row: pale-green rounded-square avatar with dark-green
   megaphone, WA row anatomy, on WHITE full-bleed rows (not cards).
3. Sections "Groups you're in" / "Groups you can join": ~20pt sentence-case
   gray headers (not ALL-CAPS card labels).
4. Joinable rows: "n members" subtitle + right chevron; member rows: last
   message preview + time/badge.
5. Bottom floating full-width green pill "+ Add group" (the screen's single
   green CTA).
6. Segmented control + centered hero move to community **info** screen only.
7. Invite/Search: fold into ⋯ or restyle as WA action cards on info screen.

### 6. New chat (WA ref 9 vs tg-06)
1. Sheet anatomy: centered "New chat" 17 semibold + X-in-circle right
   (replace "Cancel" text button).
2. Search field placeholder "Name, number…" style.
3. **Immediately list community members** (WA shows contacts without typing):
   action card first (New group / New community-equivalents that apply),
   then "Frequently contacted", then alphabetical directory. Empty
   search-first screen is a structural miss.
4. Rows: S6 anatomy, "(You) Message yourself" row pattern if applicable.

### 7. Events tab (divergence screen, tg-08)
Intentional Togather surface — but chrome must obey the system:
1. Floating buttons: neutral white circles (currently one is green-filled).
2. Uppercase "MY EVENTS/LATER" → sentence-case gray section headers.
3. Rows: S6 metrics; chevrons centered.
4. "+ Create Event" green pill ✓ correct pattern.
5. Tab bar → S2.
6. **The List/Map switch is the header's floating circle pair, not chips**
   (owner directive, 2026-07-30: "why are the events and group pages looking so
   different when they essentially have the same elements"). An interim pass had
   rendered it as an in-flow 34pt chip strip under the large title, which put
   Events and Groups on two different anatomies for the identical control.
   **Chip rows are for FILTERS; a view toggle is chrome.** Both tabs now render
   `WaScreenHeader` with the same neutral List/Map circles top-right over the
   34pt large title; Events simply leaves the search slot empty (it has no
   search feature — Groups keeps its pill + type chips). The greeting block is a
   real Events feature and stays, sitting quietly under the title on the 17/15
   row scale.

### 8. Groups tab (divergence screen, added 2026-07-29 per owner directive)

D4 restored Groups as the flag-on tab bar's first entry; the owner then asked
for the screen behind it ("groups page as well"). Flag-off it is a map-first
explore surface — full-bleed Mapbox with a `@gorhom` bottom sheet of shadowed
`GroupCard`s over it, a green floating filter circle, a green floating "+", and
a filter modal whose group-type options carry per-type color dots. That is four
S5.2 kill-list items in one screen. Flag-on (`WaGroupsScreen`) it becomes a
directory:

1. Chrome per S1 + the Events tab's neutral List/Map circle pair; "Groups" large
   title; 44pt fully-rounded live search pill (S6.5).
2. **Filters become a chip strip, and the modal goes away** (D4's chip anatomy:
   34pt, fully rounded, gray fill, 15pt dark label, horizontal scroll). It
   carries "All" + one chip per group type + the two meeting types, so both
   filter families the modal held stay reachable inline. Selected chip = the
   §1.6 pale accent tint with accent ink (WhatsApp's own selected-"All"
   treatment) — never an accent-FILLED chip, never a per-type hue.
3. Rows per S6 (58pt pastel-fallback avatars, 17/15pt, centered chevrons,
   hairlines inset to the title), full-bleed on white. A row goes straight to
   `/groups/[id]` — the single action the map's preview card ever offered.
4. Sections are **membership**, not map geometry: ~20pt sentence-case gray
   "Groups you're in" / "Groups you can join" (§5.3), replacing "Groups on map
   (n)" / "Groups not on map". The directory lists every group matching the
   filters; map-bounds filtering is a map concern and stays in the map view.
5. One green element: the bottom floating "Add group" pill (S5.1), rendered by
   the shared `WaFloatingCta` (see S5.3).
6. **The map is not dropped** — it lives behind the header's Map circle, still
   rendering the untouched `ExploreMap` + `FloatingGroupCard` preview.
7. **Find groups near me** (owner directive, 2026-07-29): a neutral white
   compass circle to the right of the search pill — a plain `WaFloatingButton`,
   because the screen's accent budget is spent on the CTA, so the active state
   reads from the filled glyph like the List/Map pair. Tapping it asks for
   foreground location (`useUserLocation`). A bare 5-digit zip typed into the
   search pill is treated as a location query rather than a name filter, so zip
   search is the always-available alternative and not merely the
   permission-denied fallback. Ordering is a local haversine over coordinates
   the container already geocodes client-side — there is no server geocode path
   in this repo and this feature does not add one. Edge states are one quiet
   gray line, never an alert.

   **An active origin sorts the WHOLE list, both sections** (owner directive,
   2026-07-30: "when typing in a zipcode it does not update the list sorted by
   distance and display the distance on the group card, it should"). The first
   pass re-sectioned only the *joinable* half into "Near you" / "More groups"
   and left "Groups you're in" alone as "not a discovery list" — but the owner
   is a member of nearly every group in their community, so zip search looked
   like a no-op. Now both **membership sections stay** ("Groups you're in" /
   "Groups you can join") and each is sorted nearest-first internally, with
   every geocoded row's distance appended to its 15pt subtitle ("Team · 6
   members · 2.3 mi"). It is a sort, not a regrouping — which is also the
   owner's own phrasing. Rows with no address are never dropped and never
   interleaved: they trail the located rows inside their own section, carrying
   no distance. `sortByDistance` in `utils/nearbyGroups.ts` is the whole rule;
   distances are looked up by group id, so rows absent from the geocoded subset
   are quietly skipped.

### S5.3 One floating CTA geometry (added 2026-07-29 per owner directive)

Events' "Create Event" and Groups' "Add group" are the same idea and had two
geometries — a centered auto-width pill with a heavy drop shadow and a 15pt
label, versus a full-width bar inset 16pt with a 17pt label. `WaFloatingCta`
is now the single definition: centered auto-width pill, `WA_FLOATING_CTA_HEIGHT`
(50pt) fully rounded, accent fill, white 17pt semibold label + glyph, and the
kit's `WA_FLOATING_SHADOW` (the same lifted-paper shadow the header circles and
the tab island use — not the material card shadow §7 bans).

It also owns the clearance, which was genuinely broken (owner's dark-mode
screenshot: the pill sitting on the tab island). **Yoga lays an absolutely
positioned child out against its parent's *border* box and ignores the parent's
padding** — unlike CSS — so `bottom: 0` inside a container reserving
`waTabBarStripHeight` did *not* start above that strip. The component instead
sets `bottom: waFloatingCtaBottomOffset(insets.bottom)` = island height +
`waTabBarBottomOffset` + 12, measured from the screen edge; scroll surfaces pad
by `WA_FLOATING_CTA_CONTENT_CLEARANCE` so the last row clears island *and* pill.

---

## Workstream mapping (one PR each, flag-on only, flag-off byte-identical)

- **WS-A Chat surface**: S4 end-to-end + chat-room nav (per-screen §2).
  Root-cause first: why wave-3 bubble fork doesn't render (diagnostic in
  flight).
- **WS-B Chrome system**: S1 floating buttons/titles + S2 floating tab bar +
  S7 scale in kit (`WaScreenHeader`, new `WaFloatingButton`, tabs layout).
- **WS-C Cards & info surfaces**: S3 kit fixes (radius/rows/icons/chevrons/
  labels) + You tab §4 + group/channel info §3.
- **WS-D Chats list**: §1 (rows S6, header via WS-B primitives, timestamps).
- **WS-E Community landing + New chat**: §5 + §6.
- **WS-F Color & avatar discipline**: S5 sweep + squircle/pastel avatar
  utility (feeds A–E; land first or fold into B).

Sequencing: WS-B and WS-A in parallel (disjoint files), then C/D/E on top of
B's primitives. Screenshot pair required in every PR description.

---

## Device-feedback pass (2026-07-29, after WS-A…F landed)

Everything above was verified on **Expo web**. The owner then ran the flag-on
build on a real iPhone and three of the four items below were invisible on web
by construction. The lesson is now a standing rule for this plan: **web parity
is not device parity — anything touching Reanimated, `resizeMode`, or a native
view must be checked on a device before it counts as done** (CLAUDE.md's
native-media rule, extended to layout).

### D1. Never animate a LAYOUT prop from a Reanimated worklet (P0)

The flag-on Chats header reserved its large-title and search-pill space by
animating their `height`. On web the browser discards the invalid animated
value and the static CSS height wins, so it looked perfect. On iOS Fabric
(reanimated **4.1.6** — a known-broken release; do NOT bump it) animated layout
props race the ShadowTree commit: **at rest the header rendered already
collapsed**, so the first rows sat under the floating buttons, and expanding it
painted through row content.

The pattern flag-on surfaces must use instead:

1. The header is `position: absolute` over the scroll view — it takes no layout
   space, so nothing about it can race a layout commit.
2. Its height is reserved by a **plain React `paddingTop`** on the scroll
   view's `contentContainerStyle`, plus a `minHeight` so a short list can still
   scroll far enough to finish the collapse.
3. The collapse animates **`opacity` and `transform` only**.
4. The overlay is `pointerEvents="box-none"`.
5. Anything that used to sit between the header and the list (banners, chips)
   moves into `ListHeaderComponent`, or it gets painted over.

`features/chat/components/waInboxHeaderGeometry.ts` holds the geometry and both
animated styles as pure functions so "no layout key in a flag-on animated
style" is a unit test, not a convention. Copy that shape for any other
collapsing header.

### D2. `resizeMode="repeat"` does not tile on iOS

The chat wallpaper used one absolute-fill `<Image resizeMode="repeat">`. RN-Web
maps that to `background-repeat: repeat`; **UIKit stretched it instead**, so a
low-alpha doodle sheet smeared into what read as a flat cream tint. `ChatWallpaper`
now lays out an explicit `ceil(w/256) x ceil(h/256)` grid of 256pt images. The
generator emits a 256px tile with motifs in the reference's ~40-55pt band, each
wrapped across all nine tile offsets so the repeat is seamless, at 0.10 (light)
/ 0.07 (dark) ink — the old 0.08/0.05 were invisible on a real screen.

### D3. Scrolled-state nav scrim (amends S1.1)

S1.1 said "no opaque nav bars" and that is still right at rest — but with
content scrolling *under* floating buttons, rows smear through the status bar.
Flag-on Chats paints a static-height scrim behind the nav zone
(`WA_NAV_SCRIM_LIGHT` / `WA_NAV_SCRIM_DARK`, 0.92) whose **opacity** fades in
with the collapse. Deliberately **not** in any kit header component: Events and
You render their headers in flow, so a shared scrim would band them permanently.

### D4. Owner product directives (amend S2.5, §1.5, §1)

- **S2.5 is superseded.** Flag-on tab order is **Groups · Events · Chats ·
  Prayer · You**, with Chats dead-centre (Groups · Events · Chats · You when
  the community has prayer off). Groups is the existing `search` route, no
  longer hidden under the shell, with a neutral people glyph instead of the map
  pin. Group discovery is the tab churches actually navigate from.
- **§1.5 is superseded.** Channel sub-rows drop the neutral "#" disc for the
  **parent group's avatar at ~55% opacity** with the channel glyph as a
  full-opacity corner badge. The anonymous gray disc made every cluster's
  sub-rows identical; the parent avatar plus the 44pt size step is what makes a
  cluster read as one family.
- **Resources leave the list.** They are now a horizontal strip of neutral
  WhatsApp-style filter chips (34pt, fully rounded, gray fill, 15pt dark label)
  under the search pill, inside the collapsible block. A 76pt chat-anatomy row
  for "Giving" read as an unread conversation, and one set per group scattered
  them down the list.
- **Community logo in the header circle.** It always fell back to initials
  because `AuthProvider` builds its community snapshot from the profile query's
  `activeCommunity*` fields, which carry name and church features but **no
  logo**. The Chats header reads the logo from the community doc directly
  rather than widening the disk-cached, app-wide auth snapshot — if another
  surface needs it, widen the snapshot there rather than repeating this query.
