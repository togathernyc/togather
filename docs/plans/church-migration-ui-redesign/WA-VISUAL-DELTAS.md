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
Flag-on chat rooms today render the flag-OFF Slack-style rows: flat avatar +
name + black text on white, plain-text date separators, no bubbles. Target:
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
