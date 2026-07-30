# WhatsApp iOS Design System — Togather "WhatsApp Plus" Spec

**Status:** source of truth for implementation. **Audience:** the ~10 agents building
the `whatsapp-shell` flag-on UI (see [README.md §9.5](./README.md#95-rollout--everything-behind-one-flag)).

> **Verification method: screenshot-first.** This spec is written to match
> `WA-VISUAL-DELTAS.md` — a side-by-side comparison of current WhatsApp iOS
> reference screenshots against the running flag-on app — not the other way
> around. Where a number or a piece of chrome guidance here ever disagrees
> with a fresh screenshot comparison, **the screenshots win and this doc gets
> corrected**, not the reverse. The four parity PRs (#643 chrome/tab bar, #644
> rows/cards/info, #645 chat surface, #647 community/new-chat) shipped against
> `WA-VISUAL-DELTAS.md`'s numbers; this revision brings the spec back in line
> with what they actually built (see the shipped kit: `apps/mobile/components/wa/`).

## 0. Product goal (read this first)

> Behind the `whatsapp-shell` flag, Togather must be **visually indistinguishable from
> WhatsApp iOS at a glance.** The only permitted departures are:
>
> **(a) Brand color** — the community's `primaryColor` (admin Settings) replaces
> WhatsApp's green (`#25D366`/`#00A884`) everywhere green is an *accent*, never
> everywhere green *appears* (see §1.3 — some greens stay neutral).
>
> **(b) Togather-only features** — resources, events, prayer, serving, rostering.
> These must be **expressed in WhatsApp's existing visual vocabulary** (rows,
> inset-grouped cells, bubbles, pills) — never as a new component language. See §7.

Every value below was originally measured off real WhatsApp iOS screenshots
(1320px-wide capture, i.e. an iPhone Pro-class screen at 3x — divide px by 3
for pt) and cross-checked against known WhatsApp iOS conventions. **Treat pt
values as calibrated guidance for rhythm and proportion, not pixel law** —
match the *relationships* (avatar-to-row-height ratio, badge-to-timestamp
alignment, section gap vs. card corner radius) over chasing an exact pixel.

A second, later verification pass (`WA-VISUAL-DELTAS.md`, 2026-07-29) compared
a fresh set of current-WhatsApp-iOS reference screenshots — the **iOS 26
design language** (floating circular nav buttons over content, no opaque nav
bars, a floating pill tab bar, ~24px-radius inset cards) — against the
running flag-on app, and corrected numbers that the first pass got wrong or
that had visibly drifted from current WhatsApp. That pass, not this original
paragraph, is the calibration source for every value in this doc; see its
own note: "where WHATSAPP-DESIGN-SYSTEM.md disagrees with these observations,
the screenshots win."

A same-directory screenshot (`a91c868c-IMG_1243.png`) also captured Togather's
**current, pre-redesign** chats list — pastel category chips ("Announcements" in
purple, "Team" in teal, "Table" in lavender, "Public Group" in coral), tree-line
indentation (`└`) for sub-rows, and shield badges glued to avatars. **This is the
anti-pattern the redesign eliminates.** It's referenced explicitly in §7.

---

## 1. Color System

### 1.1 Light mode

| Token | Value | Where |
|---|---|---|
| `bg.plain` | `#FFFFFF` | Full-bleed list screens: Chats list, chat thread list rows, New chat sheet body |
| `bg.grouped` | `#F2F2F2` (≈ iOS `systemGroupedBackground`) | Grouped/secondary screens: You tab, Community info, Chat theme, Settings |
| `bg.card` | `#FFFFFF` | Inset-grouped cards/cells sitting on `bg.grouped` |
| `bg.navBar` | *(no fill — see §4)* | Current WhatsApp iOS (iOS 26 chrome) has **no opaque nav bar at all**: 44pt floating white circular buttons sit directly over the scrolling content, and titles float on the plain screen background. `bg.navBar` as a distinct opaque-bar token doesn't apply; the floating buttons use `colors.surface`/white per §4 |
| `tabIsland.fill` | `rgba(255,255,255,0.97)` | The floating rounded-island tab bar (§4/§2) — near-white, not opaque white, not a per-tab tint |
| `separator` | `#E5E5E5` (hairline, 1px @1x) | Full-bleed row dividers, inset-grouped intra-card dividers |
| `text.primary` | `#000000` | Row titles, large title, nav title, bubble text |
| `text.secondary` | `#6D6D72` (≈ iOS `secondaryLabel`) | Message previews (read), footnotes, section footers |
| `text.tertiary` | `#8E8E93` | Read timestamps, placeholder text, chevron-adjacent value labels |
| `accent` (brand) | community `primaryColor` (WhatsApp default `#25D366`, Togather default `#1E8449`) | See §1.3 — the *only* recolored role |
| `accent.dark-variant` | community `secondaryColor` or an auto-darkened `primaryColor` (≈ WhatsApp's `#128C7E`) | Pressed/active states, outgoing-bubble-adjacent icons |
| `destructive` | `#FF3B30` (iOS system red) | Leave/exit/delete/report rows — **never** brand-mapped |
| `mention.blue` | `#0068C9`-ish "WhatsApp blue" (distinct from iOS system blue `#007AFF`) | Sender names, @mentions, shared-link card titles — **neutral, never brand-mapped** |
| `link.accent` | community `primaryColor` | In-bubble/in-row hyperlinks (URLs) render in the accent, underlined |

### 1.2 Dark mode

| Token | Value | Where |
|---|---|---|
| `bg.plain` | `#000000` | Chats list, full-bleed rows |
| `bg.grouped` | `#000000` (WhatsApp dark keeps grouped screens black too, cards pop via card fill, not bg contrast) | You tab, Community info, Settings |
| `bg.card` | `#1F2C34` | Inset-grouped cards/cells |
| `bg.navBar` | *(no fill — see §4)* | Same "no opaque bar" rule as light mode; floating buttons use `colors.surface` dark |
| `tabIsland.fill` | `rgba(31,44,52,0.97)` | Floating island tab bar, dark mode |
| `separator` | `#2A3942` | Dividers |
| `text.primary` | `#E9EDEF` | Titles, bubble text |
| `text.secondary` | `#8696A0` | Previews, footnotes |
| `text.tertiary` | `#667781` | Read timestamps, placeholders |
| `accent` (brand) | community `primaryColor`, luminance-adjusted for AA contrast on `#000000`/`#1F2C34` (WhatsApp's own dark accent is `#00A884`, a brighter/desaturated shift off its light-mode `#25D366` — apply the same shift formula to any community brand color) | Same roles as light |
| `destructive` | `#FF453A` (iOS dark-mode red) | Same rows |
| `mention.blue` | `#53BDEB`-ish (WhatsApp's dark-mode link/mention blue) | Same roles, neutral |

**Dark-mode accent rule:** never reuse the light-mode brand hex verbatim in dark mode.
WhatsApp shifts `#25D366` → `#00A884` for AA contrast on near-black surfaces. **Measured
correction:** despite the "higher lightness, slightly desaturated" framing this section
originally used, the concrete hex pair measures the opposite on both HSL lightness and
W3C relative luminance — `#00A884` is *darker and more saturated* than `#25D366`, not
lighter/desaturated. The shipped implementation (`waPalette.ts`) trusts the measured hex
pair over that adjective and calibrates its shift constants (saturation +25, lightness
×0.68, clamped 28–55 — see §1.6) against the actual delta. Apply an equivalent HSL
saturation/lightness adjustment to each community's `primaryColor` rather than
hard-coding two brand colors per community.

### 1.3 Brand-accent substitution rule

This is the load-bearing table. Get it wrong and the app either looks like generic
WhatsApp (forgot to brand it) or looks broken (branded something that should stay
neutral, e.g. tinted the back button).

| WhatsApp green usage | Maps to `primaryColor`? | Notes |
|---|---|---|
| Unread badge fill (chat list count pill) | **Yes** | White numeral on `accent` fill |
| Unread row timestamp color | **Yes** | Read rows use `text.tertiary` gray instead |
| Compose `+` FAB / header circular accent buttons | **Yes** | |
| "Add group" / "Add Members" / "Add Groups" pill buttons & their icons | **Yes** | |
| Outgoing chat bubble fill | **Yes**, as an **HSL-pinned light tint** of `primaryColor` (saturation +15, lightness clamped to 90–93 — see §1.6) — **not** the full-saturation brand color and **not** a flat opacity mix (a flat mix desaturates unpredictably depending on the brand color's own lightness) | Full-saturation brand color on a bubble reads too loud; WhatsApp never does this |
| In-message/in-bubble URL links | **Yes** | Underlined, `accent` color |
| Toggle "on" track color | **Yes** | |
| New-chat-sheet action icons (New group/community/broadcast) | **Yes** | These are creation affordances, matching the FAB |
| Action-sheet-style green text rows (Add to Favorites, Export chat, Add to list) | **Yes** | Left-aligned, no icon, no chevron — see §3.3 |
| "Going"/RSVP-affirmative semantic states *if* reusing WhatsApp's own green-for-positive convention | **Yes, but see §7** | Only when the state literally means "confirmed/positive" — don't brand-color RSVP chips just for prettiness |
| — | | |
| Back chevron + back-button label (WhatsApp shows unread-count-as-label, e.g. "‹ 62") | **No — stays `text.primary` black** | WhatsApp deliberately overrides iOS's default blue back button to neutral black. Do not brand this. |
| Settings/info-screen leading icons (Media, Storage, Notifications, Chat theme, Lock chat, Encryption, etc.) | **No — stays `text.primary`/`text.secondary` black-gray, plain glyph, no colored background chip** | This is the single most common mistake: do NOT port iOS Settings-app's colored-rounded-square icon treatment. WhatsApp's own info screens use flat monochrome glyphs, no icon backgrounds at all. |
| Sender name colors in group chats / @mention text | **No — fixed neutral rotating palette** | See §5; a deterministic per-sender palette (blue, orange, teal, purple, pink, olive…) unrelated to brand color. Never recolor these to `primaryColor`. |
| Destructive red rows (Exit community, Report, Clear chat, Delete) | **No — stays system red**, see §1.1 | |
| Floating-button fills, large title text, row title text | **No — stays neutral white/black** | There's no nav-bar fill to color at all (§4) — WhatsApp's chrome is deliberately colorless; only the *accents floating on it* (buttons, badges) carry brand color |
| Chat wallpaper doodle pattern | **No — stays neutral cream tone-on-tone**, unless the community explicitly picks a themed wallpaper (§1.5) | |
| Read-receipt double-check marks | **No.** Delivered = gray double-check. Read = **WhatsApp-blue** double-check (`#34B7F1`-ish), never brand-colored | This is WhatsApp's single most recognizable non-green color signal — don't touch it |
| Muted-chat bell-slash glyph | **No — neutral gray** | |
| Active/selected tab icon+label (bottom tab bar) | **No — stays one neutral ink whether focused or not** (`#0A0A0A` light / `#E9EDEF` dark) | This was the spec's own biggest miss (WA-VISUAL-DELTAS S2.2: "Togather's green filled active icon + green label is the single loudest 'not WhatsApp' signal on every screen"). The active tab is marked by a light-gray highlight pill wrapped around icon+label (`#E3E3E8` light / `rgba(255,255,255,0.16)` dark), never by color. See §4. |
| Community/group/person/event fallback avatar (no photo) | **No — muted per-entity pastel, never `accent`/green** | A fixed 14-hue wheel (clay, apricot, sand, olive, moss, teal, sky, steel blue, periwinkle, iris, violet, orchid, rose, dusty pink), hashed deterministically per entity id (FNV-1a + avalanche finalizer so sibling ids don't cluster on one hue) — WhatsApp green (~142°) and iOS red (~0°) are deliberately excluded from the wheel. Structural (non-entity) discs — a channel "#" avatar, a "+N more channels" expander — use a separate hue-less neutral gray palette instead. See `apps/mobile/components/wa/waAvatarColor.ts` (`waAvatarPalette` / `waNeutralAvatarPalette`). |
| Quick-action row icons (Add Members / Invite / Search on info screens) | **No — plain white/`bg.card` rounded action cards, dark glyph** | Superseded from an earlier "accent-tinted circular icon" treatment: the reference shows white button cards, not colored circle glyphs (WA-VISUAL-DELTAS S5.2 kill-list: "green circle Invite/Search glyphs on community page — WA uses white button cards"). See §3.2. |

### 1.4 Destructive red

Never brand-mapped (see table above). Used for: `Exit community` / `Exit group` /
`Leave channel`, `Delete chat` / `Clear chat`, `Report announcements` / `Report`,
`Remove member`, `Delete message`. Two renderings:

- **Inline grouped-list row** (Community info style): left-aligned red text, 17pt
  regular, no leading icon, no chevron, same 54pt row height as neutral rows in
  the same card (§3.2).
- **Modal/action-sheet row** (native `UIAlertController`/action-sheet destructive
  action): centered red text, 20pt regular, full-width row, own card, no icon.

### 1.5 Chat wallpaper & doodle treatment

Default wallpaper: cream tone (`#F6F1E9`-area light / a matching dark variant) with a
**very low-contrast tone-on-tone doodle pattern**, tiled at low opacity, same hue
family as the base so it reads as texture, not imagery — sitting *behind* every
bubble, day pill, and the translucent nav/composer bars, never interfering with text
contrast.

**Shipped implementation note:** the tile art is **original artwork generated by
`scripts/generate-chat-wallpaper.mjs`**, not WhatsApp's own copyrighted doodle sheet
— deliberately not reused. `ChatWallpaper.tsx` (`apps/mobile/features/chat/components/`)
renders it as an absolutely-positioned, non-interactive layer: a base fill from the
theme's `chatWallpaper` token, with a light/dark 256pt tile laid out as an explicit
grid of `<Image>`s over it. The tiles are **inlined as base64 data URIs** in the
generated `features/chat/chatWallpaperTiles.ts`, not `require()`d from `assets/` —
as bundled PNGs they were expo-updates assets newer than the installed binary and
never resolved on device over OTA (owner report, 2026-07-30). It's dropped once
behind the whole chat-room screen (header, tab strip, message list, composer)
rather than per-section, and only renders behind the flag-on chat surface.

**Safe-area strips:** the wallpaper layer cannot reach either screen edge — the
status-bar zone is `paddingTop` on `ChatRoomSurface` and the home-indicator zone
is `paddingBottom` on the app-wide `StatusBarAwareContainer`, and padding sits
outside the children's box. Those two bands therefore paint the *chrome's*
rendered tone as a solid color (`waChatChromeOpaque` / `waComposerBarOpaque` in
`features/chat/waChatChrome.ts`, which flatten the translucent bar fills over
`chatWallpaper`), so the header and composer read as continuing to the edge.
Painting them with the wallpaper base or the app's root `background` is the bug
that shipped: a white band under the composer in light mode, near-black bands at
both edges in dark mode.

Togather mapping: default wallpaper stays this neutral cream/dark tone — **do not
tint the wallpaper with `primaryColor`.** The WhatsApp "Chat theme" screen (§6) lets
a user pick from a curated wallpaper+bubble-color gallery; Togather's community-level
equivalent (P2 per README §11.5) would let an admin pick a *curated* wallpaper for
the community's default theme, but the out-of-the-box default must stay neutral so
the accent substitution rule (bubble-tint-only) still reads clearly.

### 1.6 Incoming vs. outgoing bubble colors

| | Light | Dark |
|---|---|---|
| Incoming bubble | `#FFFFFF`, subtle drop shadow (`0 1px 0.5px rgba(0,0,0,0.08)`) | `#1F2C34` |
| Outgoing bubble | `accent`, HSL-shifted (see below) — **not** a flat opacity mix over white | `accent`-derived dark teal-green shift — a *saturated dark* tint, not a light tint, because dark-mode outgoing bubbles need to read as "filled," not "washed out" |
| Bubble text | `text.primary` in both — bubble fill never gets dark enough/light enough to need inverted text | `text.primary` |

**Shipped derivation** (`apps/mobile/utils/waPalette.ts`, `waAccentPalette()`): a flat
opacity mix (`primaryColor` at ~18% over white) desaturates unpredictably depending on
the brand color's own lightness — a forest-green brand came out gray-sage instead of a
WhatsApp-style pale mint. The shipped formula instead pins the bubble into WhatsApp's
own measured light band regardless of input lightness:
- **Light-mode outgoing:** saturation +15, lightness clamped to **90–93**. An
  (near-)achromatic brand color (saturation ≤8, i.e. effectively gray) is exempted from
  the saturation boost — boosting a hue-less color paints the bubble an unintended pink.
- **Dark-mode outgoing:** saturation +30, lightness scaled ×0.37 and clamped to 12–30 —
  calibrated against WhatsApp's own `#25D366` → `#005C4B` (L 48.6→18.0) shift.
- **Dark-mode accent** (badges, FAB, active states — not the bubble) uses a separate,
  lighter shift: saturation +25, lightness ×0.68 clamped to 28–55, calibrated against
  `#25D366` → `#00A884`.

### 1.7 Badge-green → brand mapping rule

Every WhatsApp badge that is literally the app's own accent color (unread count pill,
FAB, "Add group" button) maps 1:1 to `primaryColor`. This is distinct from — and must
not be confused with — the **banned pattern** in Togather's pre-redesign UI (see
`a91c868c-IMG_1243.png`): arbitrary pastel category chips ("Announcements" purple,
"Team" teal, "Table" lavender, "Public Group" coral) used as a taxonomy label system.
WhatsApp has **no such thing** — it has exactly one accent color used consistently,
never a rainbow of category colors. See §7 for the explicit ban.

---

## 2. Typography

All sizes in pt, SF Pro (San Francisco) system font, Dynamic Type should scale these
but the spec below is at the default (Large) size class.

Sizes below are the shipped **S7 scale** (`WA_TYPE_*` in `apps/mobile/components/wa/metrics.ts`)
— WA-VISUAL-DELTAS.md's audit found the original spec-derived sizes ran "1–2pt small and
one weight light throughout"; these are the corrected, measured values.

| Role | Size / Weight | Color | Used |
|---|---|---|---|
| Large title | 34pt **Heavy** (weight 800) | `text.primary` | "Chats" only — floats directly over the plain background, no nav-bar fill (§4) |
| Hero name (profile/entity hero) | 28pt Bold | `text.primary` | Group/channel/You-tab avatar hero name |
| Header block (screen header) | 22pt Bold | `text.primary` | Community landing screen's left-aligned name block |
| Sub-screen title (floating, centered) | 17pt Semibold | `text.primary` | Centered title floating over the grouped-gray background on sub-screens (Community info, New chat) — no bar fill |
| Row title (chat/group name) | 17pt — **Semibold when unread, Regular when read** | `text.primary` | Chat list row primary line |
| Row subtitle / message preview | 15pt Regular (**Semibold** only for the "you're mentioned" bold-preview state) | `text.secondary` (read) | Chat list row second line |
| Timestamp (row) | 15pt Regular | `accent` if unread, `text.tertiary` if read | Right-aligned, top of row's right column |
| Section header (landing screens) | ~20pt Semibold, **sentence-case** | `text.secondary` | "Groups you're in", "Groups you can join" — large, gray, never uppercase |
| Section label (inset-grouped card group) | 15pt Regular, **sentence-case** | `text.secondary` | Above a card group, e.g. "Leader tools" — **no `toUpperCase()`, no letter-spacing**; ALL-CAPS 13pt labels ("MEMBERS", "LEADER TOOLS") are dead, see §3.2 |
| Section footer | 13pt Regular | `text.tertiary` | Explanatory text under a card, e.g. "Created by…", "This chat has added privacy for your phone number. Learn more." |
| Footnote / helper text | 13pt Regular | `text.tertiary` | Sub-line under a settings row (e.g. under "Lock chat") |
| Grouped-list cell title | 17pt Regular | `text.primary` | "Media, links and docs", "Notifications" |
| Grouped-list value label | 17pt Regular | `text.tertiary` | Right-aligned value before chevron, e.g. "5.4 MB", "Off", "On" |
| Bubble text | 16pt Regular (measured ~15.5–17pt) | `text.primary` | Message body |
| Bubble sender name (group chats) | 14–15pt Semibold | Per-sender neutral palette color (§5) | First line inside an incoming bubble, group chats only |
| Bubble timestamp + ticks | 11pt Regular | `text.tertiary` on incoming; `rgba(0,0,0,0.45)`-on-tint (light) / `rgba(255,255,255,0.6)`-on-tint (dark) on outgoing | Bottom-right inside bubble, ticks immediately follow |
| Day pill | 13pt Semibold | `text.secondary`, on a **solid** white/`#1F2C34` pill fill — **not translucent** (a translucent fill washed out against the wallpaper) | "Friday", "Sat, Jul 18" |
| Composer placeholder | 17pt Regular | `text.tertiary` | Empty message input |
| Tab bar label | 10pt Semibold | **one neutral ink for both states** (`#0A0A0A` light / `#E9EDEF` dark) — never `accent`; the active tab is marked by a highlight pill, not a color change (§4) | Bottom tab bar |
| Community/group member count, hero subtitle | 15pt Regular | `text.secondary` | "Community · 2 groups" |

---

## 3. List Anatomy

### 3.1 Full-bleed chat rows (Chats list, New-chat contact list)

- **Row height:** **78pt** (2-line preview present); 60pt if a row has no preview
  text. Corrected up from an original 76pt spec figure — WA-VISUAL-DELTAS S6.1 flagged
  avatar/row density as "the biggest single density delta" against the reference.
- **Avatar:** **58×58pt** (corrected up from 56pt — same S6.1 finding). Circular for
  people/groups/channels. **Rounded-square ("squircle") for Communities** — this is
  the one shape distinction in the whole system and it's load-bearing: it's the only
  way a user tells "this row opens a community" from "this row opens a chat" at a
  glance. Shipped as a `shape: 'circle' | 'squircle'` prop on the shared row component.
- **Leading padding:** 16pt from screen edge to avatar.
- **Avatar-to-text gap:** 12pt.
- **Trailing padding:** 16pt from text column edge to screen edge.
- **Right column** (timestamp + badge), fixed-width ~60pt, right-aligned, stacked
  vertically: timestamp on top, badge/mute-icon below it, ~4pt gap.
- **Unread badge:** filled `accent` capsule/circle, min 20pt diameter (grows
  horizontally past 2 digits, min 8pt horizontal padding), white bold 12pt numeral,
  right-aligned under the timestamp. **Community/multi-channel-cluster rows dock a
  chevron inside the badge** instead of a plain numeral (e.g. "7 ›") — WA-VISUAL-DELTAS
  S6.3; shipped as a `badgeChevron` prop.
- **Muted indicator:** small gray bell-slash glyph (~14pt), sits left of (or in place
  of, if no unread) the badge position — badge itself stays `accent`-colored even
  when muted; only the bell-slash communicates mute state.
- **Timestamp format:** WhatsApp shows *when*, not *how long ago* — today's time
  (`3:42 PM`), `Yesterday`, the weekday name for 2–6 calendar days back, then a short
  numeric date (`7/3/26`). Boundaries are local-midnight-anchored (calendar days, not
  elapsed hours), and both the time-of-day and short-date formats are locale-aware via
  `Intl`. Replaces an elapsed-duration format (`now`/`12m`/`4h`/`4d`/`Jul 3`). See
  `formatWaListTimestamp()` in `apps/mobile/components/wa/waListTimestamp.ts`.
- **Separator:** 0.5–1px hairline, **inset to align with the text column** (starts
  at `leading padding + avatar width + gap` from the left edge, full-bleed to the
  right edge). Full-width separators (no inset) only appear before section-starting
  utility rows like "Archived."
- **Community/cluster stacked-card treatment:** when a row represents a community
  or a multi-channel group cluster, render 1–2 "ghost" card edges peeking from
  behind the primary squircle avatar's top-left corner — offset ~4–5pt diagonally,
  lighter fill or a thin border, no content — signaling "there's more behind this."
  Used for community rows in the Chats list and (Togather-specific) multi-channel
  group clusters.
- **Swipe affordances (note only, no exact spec required):** swipe-left reveals
  Archive/More/Delete action buttons; swipe-right toggles Read/Unread and reveals a
  Pin action. Implement with the platform's native swipe-actions API
  (`react-native-gesture-handler` / iOS `UISwipeActionsConfiguration` equivalent),
  not a custom gesture system.

### 3.2 iOS inset-grouped lists (Settings, Community info, Group/Channel info)

- **Screen background:** `bg.grouped`.
- **Card corner radius: 24pt.** Corrected way up from an original 10pt "standard iOS
  `insetGrouped`" figure — WA-VISUAL-DELTAS S3.1 called the old 10–12pt radius
  "visibly wrong at a glance" against current WhatsApp's ~24px cards; this was the
  single most visible card delta in the whole audit.
- **Card horizontal margin:** 16pt from screen edge.
- **Cell height: 54pt minimum** (single-line) — corrected up from a 44pt iOS
  tap-target-floor figure that read as "too dense" (S3.2); 64–76pt when a cell wraps a
  description/footnote sub-line (e.g. "Lock chat" with its explanatory text).
- **Cell horizontal padding:** 16pt leading/trailing inside the card.
- **Icon treatment: plain, flat, monochrome glyph — no colored rounded-square
  background chip.** This is a deliberate departure from Apple's own Settings app
  (which uses colored icon badges) and must be followed exactly: icons are **24pt,
  black** (`text.primary`, ~1.5px stroke — corrected from an original "thin gray
  ~20-22pt" figure that read as too light/small), fixed 24pt icon column, 16pt gap
  before the label starts.
- **Chevron:** `chevron.right`, 13pt, `text.tertiary`, trailing edge, **vertically
  centered on the row** — the original build had chevrons hugging the row's
  top-right corner on every card, a misalignment WA-VISUAL-DELTAS S3.3 flagged
  explicitly; 8pt gap from any value label.
- **Value label:** right-aligned `text.tertiary`, 17pt, sits immediately left of the
  chevron — e.g. "5.4 MB >", "Off >", "On >", "13 >".
- **Row variants observed:**
  - *Navigational* (title + chevron): "Media, links and docs", "Manage storage"
  - *Navigational + value* (title + value + chevron): "Save to Photos — Off",
    "Advanced chat privacy — On"
  - *Toggle* (title + optional 1–2 line description + `UISwitch`, no chevron):
    "Lock chat"
  - *Plain text action, no icon, no chevron, accent-colored*: "Add to Favorites",
    "Add to list", "Export chat" (§1.3 — brand-mapped)
  - *Destructive, no icon, no chevron, red*: "Clear chat", "Exit community",
    "Report announcements" (§1.4 — never brand-mapped)
- **Section labels: sentence-case, not ALL-CAPS.** WA info screens mostly carry
  **no** section label at all; where one exists it's a plain sentence-case gray
  string at 15pt (`text.secondary`, no `toUpperCase()`, no letter-spacing) sitting
  *above* the card, 16pt leading padding matching the card margin, ~8pt gap to the
  card below. **The old 12–13pt ALL-CAPS treatment ("MEMBERS", "LEADER TOOLS",
  "GROUPS YOU'RE IN") is dead** — it read as iOS-15 Settings, not current WhatsApp
  (S3.5). Landing-screen section headers ("Groups you're in") are a distinct, larger
  ~20pt semibold sentence-case role — see §2.
- **Section footers:** sit *below* their card, same margin, 13pt gray, wraps to
  multiple lines freely (e.g. "Created by +44 7581 068048. Created Jul 27, 2024.").
- **Spacing between groups (cards):** ~24–32pt — visibly more generous than the
  header-to-card gap (~8pt), so cards read as discrete clusters, not one long list.
- **Tab-style segmented control** (seen atop Community info: "Community" /
  "Announcements"): full-width, ~36pt tall, rounded-rect selector, `bg.grouped`
  track, white/`bg.card` selected pill, sits between the hero and the first card,
  no card wrapper of its own.
- **Action-button row above the cards** (Community/Group/Channel info's Invite /
  Search / Mute / Open chat): **white rounded action cards**, not accent-tinted
  circular icons. Corrected from an earlier "36–40pt circle, `accent`-tinted icon, no
  filled background" treatment — WA-VISUAL-DELTAS S5.2 explicitly bans the green
  circle Invite/Search glyphs Togather shipped first ("WA uses white button cards").
  Shipped anatomy: ~76pt-tall, 18pt-radius white/`bg.card` cards in a row, a 24pt
  glyph + 15pt label inside each, 10pt gap between adjacent cards.

### 3.3 Red/destructive rows & centered action rows

Covered in §1.4 — repeated here for the list-anatomy context: destructive rows never
carry a leading icon or trailing chevron in either the inline-grouped or
action-sheet-centered variant, distinguishing them from every other row type at a
glance (icon+chevron = navigate; plain colored text = irreversible/singular action).

---

## 4. Navigation Chrome

**Corrected wholesale for this revision.** The prior version of this section
described classic-iOS chrome (opaque nav bars, a scroll-collapsing large title, an
edge-to-edge tab bar). Current WhatsApp iOS — the **iOS 26 design language** the
owner's reference screenshots show — uses none of that: **there is no opaque nav
bar anywhere in the flag-on UI.** Every top-level and sub-screen instead floats
circular buttons and titles directly over the scrolling/grouped-gray content. This
was WA-VISUAL-DELTAS S1's top cross-cutting finding and PR #643 rebuilt the chrome
kit (`WaFloatingButton.tsx`, `WaTabBar.tsx`) around it.

- **No opaque nav bars, anywhere.** Top-level screens (Chats) float white **44pt
  circular** buttons (`WA_HEADER_CIRCLE_SIZE`) directly over the content — e.g.
  Chats: `⋯` circle top-left, camera circle + solid-accent `⊕` circle top-right —
  with a subtle shadow (8px blur, 8% black — `WA_FLOATING_SHADOW`) rather than a
  bar fill or hairline. Sub-screens (Community info, New chat) float a single
  white circular back button (chevron, black) instead; chat rooms' back circle
  contains the chevron **plus the total unread count** ("‹ 62"). Two button
  variants only — `plain` (white/`surface` fill, black glyph — every circle
  including the back button) and `accent` (solid brand fill, white glyph —
  reserved for the Chats compose `+`, the only accent circle in the chrome). See
  `WaFloatingButton.tsx`.
- **Large title:** 34pt **Heavy** (weight 800), left-aligned, sits directly below
  the floating-button row (10pt gap, `WA_FLOATING_ROW_TITLE_GAP`) — "Chats" only.
  There is no scroll-collapse-into-a-bar behavior to preserve, because there's no
  bar to collapse into.
- **Sub-screen titles:** a **centered** 17pt semibold title (Community info, New
  chat) floating with no bar fill over the plain/grouped-gray background — not a
  collapsed large title, a standalone centered title.
- **You tab has no large title at all.** Remove "You" as a title entirely — the
  screen shows only the floating buttons plus the centered avatar hero below them.
- **Header circle spacing/glyphs:** 44pt diameter, 10pt gap between adjacent
  circles (`WA_HEADER_CIRCLE_GAP`), 22pt icon centered inside each
  (`WA_HEADER_ICON_SIZE`).
  - **Togather adaptation:** since Togather's tab bar already anchors the
    community switcher (README §5, Rule 3) at this position, treat the `⋯`
    slot as the community-switcher avatar per the existing plan (pass it as
    `children` to `WaFloatingButton` rather than an `icon`) — but it must still
    render as a floating white circle, not a colored avatar chip beside the title.
- **Back button:** floating white circle (see above), chevron **and** any label
  render in `text.primary` black, never accent blue (WhatsApp overrides iOS's
  default blue back button — see §1.3).
- **Search pill: 44pt tall** (corrected up from an original 36–38pt figure —
  WA-VISUAL-DELTAS S6.5 called the old pill "too thin"), fully rounded (radius =
  height/2), `bg.grouped`-ish fill, 17pt `text.tertiary` magnifying-glass icon
  (`WA_SEARCH_PILL_ICON_SIZE`), 8pt gap to a 17pt placeholder in `text.tertiary`,
  full-width minus 16pt margins each side, sits 12pt below the large title.
- **Tab bar: a floating rounded island, not an edge-to-edge bar.** This was the
  original spec's biggest miss (S2.2: "Togather's green filled active icon + green
  label is the single loudest 'not WhatsApp' signal on every screen"). Shipped
  anatomy (`WaTabBar.tsx`):
  - A pill inset **10pt** from each screen edge (`WA_TAB_ISLAND_MARGIN_H`),
    sitting **8pt** above the bottom safe inset (`WA_TAB_ISLAND_BOTTOM_GAP`),
    **64pt tall**, fully rounded (32pt radius), absolutely positioned so content
    scrolls *underneath* it (not a translucent-on-scroll bar — a real floating
    island, always).
  - Fill: near-white **`rgba(255,255,255,0.97)`** light / **`rgba(31,44,52,0.97)`**
    dark — deliberately near-opaque rather than a lighter translucency, since an
    rgba fill can't blur and a lighter alpha let rows show through as a muddy
    double-image the reference never shows.
  - Icons **24pt** thin-line, label **10pt**, **2pt** gap between them — and both
    render in **one neutral ink regardless of focus state** (`#0A0A0A` light /
    `#E9EDEF` dark). **The active tab is never colored.** It's marked by a light
    gray highlight pill wrapped around icon+label (`#E3E3E8` light /
    `rgba(255,255,255,0.16)` dark, 18pt radius) — a clear step darker than the
    near-white island but still unmistakably light.
  - Unread badge rides the icon's top-right corner: `accent`-filled capsule,
    white bold ~11pt numeral, offset ~-4/-4pt — same shape/rules as §3.1's row
    badge.
  - **You tab shows the user's own avatar photo** (24pt, falls back to a person
    glyph) as its tab icon, not a generic "You" icon.
  - Togather uses **4 tabs** (Chats · Events · Prayer · You per README §5); all
    four get identical island styling — there's no per-tab exception.
  - A screen pairs the island with two paddings so its whole zone reads as ONE
    page-colored surface: `waTabBarStripHeight(bottomInset)` on the container
    carrying the page background — the **band**, running from the screen's
    bottom edge to 8pt above the island's TOP edge (80pt at inset 0, 86pt at
    inset 34) — and `WA_TAB_CONTENT_CLEARANCE` (12pt) as the scroll content's
    bottom padding, which is only breathing room above that band.
  - **Reserving just the strip *below* the island is not enough** (the bug the
    owner reported on 2026-07-29 and again on 2026-07-30, "the bottom of these
    pages is still not a uniform color"): the island is 64pt tall and inset
    20pt from each edge, so rows kept rendering **beside** it in those side
    margins and underneath it. The band must cover the island's full height.

---

## 5. Chat Screen

- **Wallpaper:** §1.5 — cream tone-on-tone doodle, dropped once behind the whole
  chat-room screen (header, tab strip, message list, composer) so it stays visible
  under the translucent nav/composer bars, extends edge-to-edge. Rendered by
  `ChatWallpaper.tsx` as an absolutely-positioned layer, flag-on only.
  **Implementation note:** the message list's own container must be transparent
  for the wallpaper to show through at all — an earlier build painted it opaque
  white unconditionally (covering the wallpaper, white bubbles, white day pills,
  and gray timestamps entirely invisibly against it, WA-VISUAL-DELTAS S4's root
  cause finding). `MessageList.tsx` now switches its background to `'transparent'`
  under the whatsapp-shell flag.
- **Bubble geometry:**
  - **Max width: 75%** of screen width (corrected from an original ~78% figure;
    `WA_BUBBLE_MAX_WIDTH_PCT`).
  - **Corner radius:** 18pt on the three "open" corners (`WA_BUBBLE_RADIUS`); the
    corner nearest the sender's origin (bottom-left for incoming, bottom-right for
    outgoing) is squared/tailed on the **first bubble in a consecutive run**, 4pt
    radius there (`WA_BUBBLE_TAIL_CORNER_RADIUS`), full 18pt on continuation
    bubbles.
  - **Tail:** a small triangular/curved notch on the first bubble of a run only,
    pointing toward the avatar (incoming, left) or screen edge (outgoing, right);
    consecutive bubbles from the same sender drop the tail and tighten vertical
    gap to 2pt (`WA_BUBBLE_GROUPED_GAP`) vs. 9pt between different senders/runs
    (`WA_BUBBLE_RUN_GAP`).
  - **Bubble padding:** 10pt vertical, 12pt horizontal internal padding.
  - **Horizontal margin:** incoming bubbles start 8pt right of the avatar
    (avatar only shown on the *last* bubble of an incoming run, others show blank
    avatar-width gutter); outgoing bubbles hug the trailing edge with 8pt margin,
    no avatar (it's "you").
- **Grouping consecutive messages:** same sender + within a short time window
  (WhatsApp uses ~1 minute) collapse into one visual run: no repeated sender name,
  no repeated avatar, tightened spacing (2pt), only the *last* bubble in the run
  shows a timestamp/ticks unless an individual bubble is tapped.
- **In-bubble timestamp + ticks placement:** bottom-right corner of the *last*
  bubble in a run, inline after the text (text reflows around it, never a separate
  line unless the message is very short/single-word, where the timestamp still
  right-aligns below). 11pt (`WA_TYPE_MICRO`). Ticks (outgoing only): single gray
  check = sent, double gray check = delivered, **double WhatsApp-blue check =
  read** (never brand-accent — §1.3).
- **Day pills: solid** floating capsule (13pt semibold text, **solid** white
  light / `#1F2C34` dark fill with a soft shadow, 6pt vertical/14pt horizontal
  padding, fully rounded), sticky at the top of the viewport while its day's
  messages are in view, otherwise inline between message groups ("Friday",
  "Fri, Jul 17", "Sat, Jul 18"). **Corrected from an originally-specced
  translucent `bg.card`-ish fill** — against the doodle wallpaper a translucent
  capsule washed out, so the shipped pill is solid (`WaDayPill.tsx`).
- **Sender-name colors in groups:** shown as the first line inside the *first*
  bubble of an incoming run only, 14–15pt semibold, colored from a **fixed
  6-hue neutral rotating palette** deterministically hashed per sender —
  **not the brand accent**, per §1.3. 1:1 chats never show a sender name.
- **Reply-quote bar:** sits atop the bubble it's attached to, inside the same
  bubble shape (not a separate element) — a **4pt** colored left-border strip
  (matching the quoted sender's assigned neutral color) + the quoted sender's name
  (same neutral color, 13pt semibold) + truncated original text (13pt, `text.secondary`,
  1 line max, ellipsis) + optional thumbnail (28×28pt) if the quoted message had
  media, all in a slightly recessed/tinted sub-region (~6% black or ~6% white mix)
  above the reply's own text. **Corrected from an originally-specced ~3pt
  strip** — at 3 it read as a hairline rule rather than a colored bar
  (`ReplyQuoteBlock.tsx`, `WA_REPLY_QUOTE_BORDER_WIDTH`). A caption-less media
  parent shows a glyph + noun ("Photo"/"Video"/"Voice message"/"Document") in
  place of text; a deleted parent shows "Original message was deleted". Tapping
  the bar scrolls to the quoted message and flashes it.
- **Replies vs. threads (activation).** WhatsApp has no threads, so this is the
  one place Togather has to extend the language rather than copy it. The rule:
  - **A message's FIRST reply is not a thread.** It renders as an ordinary
    bubble at its own place in the timeline, with the reply-quote bar above its
    text. No pill, no separate row, nothing else.
  - **The moment a second live reply exists, the conversation collapses.** Every
    reply to that parent leaves the timeline and one summary pill appears
    directly under the parent bubble: up to 3 overlapping replier mini-avatars
    (most recent first), "N replies", the last reply's relative time, a chevron,
    and a small unread dot when a reply landed after you last read the channel.
    Neutral solid `bg.card` fill so it reads as chrome on the wallpaper; the
    count in `accent`. Tapping it opens the thread screen.
  - "Live" means **visible to this reader**: non-deleted, in this channel, and
    not from someone they've blocked. It's evaluated per-read, so the transition
    runs **both ways** — delete or block one of two repliers and the survivor
    comes back inline. The parent's stored `threadReplyCount` is a monotonic
    send counter (blind to deletes, blocks, and cross-channel rows) and must
    never be used for this decision, nor for the pill's count.
  - The pill's count is exact up to 50 and reads **"50+ replies"** past that —
    an honest bound rather than an unbounded read or a stored counter.
  - **The send that causes the collapse navigates its sender into the thread.**
    Otherwise the message they just sent appears to vanish: both replies leave
    the timeline and are replaced by a pill on a parent that may be scrolled far
    away. Only that one send — a first reply stays put, and sends from inside
    the thread screen never navigate. The tap that collapses a thread is often
    on the inline REPLY, not on the parent, so the timeline reports both as ways
    into the same thread and the navigation opens the root.
  - Threads are exactly **one level deep**, and `sendMessage` is what guarantees
    it: a chosen parent is walked up to its thread ROOT before the row is
    written, so replying to a reply JOINS that thread instead of forking a new
    one off it. Originally this leaned on the thread screen always sending
    `parentMessageId` = the root and assumed the timeline therefore had no
    reply-to-a-reply case — it did (tap reply on an inline reply), and the
    result was the defect this rule now prevents: every reply became the lone
    reply of a brand-new parent, so a chain of quote bubbles rendered inline
    forever and no thread ever activated.
  - **The quote follows the tapped message; the thread follows the root.** That
    is WhatsApp's behaviour and the two diverge whenever you reply to a reply,
    so the row carries `quotedMessageId` (the tapped message) alongside
    `parentMessageId` (the root). The quote bar reads it and falls back to
    `parentMessageId`.
  - Rows written before rooting can be chained arbitrarily deep. The read path
    folds them in — admission, the pill's count and the thread screen all resolve
    the root with a bounded walk, and a reply carrying its own send counter is
    descended into — so old chains collapse correctly with **no data migration**.
  - This replaces the floating "ghost" pointer (a bubble-less echo of the
    original message at the thread's `lastActivityAt`), which existed only
    because the timeline hid every reply. Kept for flag-off.
- **Reaction chips:** small pill(s) anchored to the bottom-outer corner of a
  bubble, overlapping it by ~40%, white/`bg.card` fill with a thin border, 1px
  shadow, emoji ~13pt + count ~12pt if >1, tap to see who reacted.
- **Composer bar:** translucent, sits directly over the wallpaper — **no hairline
  border, no opaque fill.** `rgba(247,245,242,0.86)` light / `rgba(17,27,33,0.86)`
  dark (`WA_COMPOSER_BAR_LIGHT`/`_DARK`), `borderTopWidth: 0`. Corrected from an
  original "gray opaque bar" build.
- **Composer anatomy** (left to right): plain `⊕` glyph (28pt, no circle, no fill —
  **not** the boxed circle button treatment used elsewhere in the chrome; it's a
  utility action not a "create" action) → rounded pill text input (min 36pt tall,
  grows with content, white light / `#1F2C34` dark fill, 17pt placeholder) with a
  sticker glyph inset at its trailing edge inside the pill → camera icon (outside
  the pill, trailing) → mic icon (outside, trailing-most), shown only while the
  field is empty. All non-pill glyphs ~24pt, neutral dark-gray/`icon` ink.
  **Send morph:** once text is entered, camera/mic are replaced by a single
  filled `accent` circular send button (arrow-up glyph); clearing the text
  reverts to camera+mic.
  - **Sticker/GIF glyph is gated behind a KLIPY API key.** It renders only when
    `EXPO_PUBLIC_KLIPY_API_KEY` is set in the environment; the documented
    degradation without a key is simply "GIF picker hidden" — no broken/disabled
    icon state. Same gate applies to the GIF option in the attachment picker
    opened from `⊕`. See `MessageInput.tsx`.
- **Announcement footer note:** persistent, non-scrolling footer strip pinned
  above the composer (or replacing it entirely for non-admins in a
  read/react-only channel): centered, 13pt, `text.secondary` with the actionable
  noun in `accent` — "You can reply to announcements, but only **community
  admins** can send them." Confirmed verbatim in `f6faf237-IMG_1225.png`.

---

## 6. Components

- **Sheets / action sheets:** modal presentation, ~16pt top corner radius, drag
  handle bar (36×5pt, `text.tertiary`, centered, 8pt from top), title row with a
  circular `×` dismiss button (36pt, `bg.grouped` fill, top-trailing) for full-sheet
  modals like "New chat"; native bottom action sheets (no drag handle, system-owned)
  for short destructive confirmations.
- **Toggles:** native `UISwitch` geometry, 51×31pt, track = `text.tertiary`-ish gray
  off / `accent` on, white knob, standard iOS spring animation — never a custom
  toggle component.
- **Avatars:** circular for person/group/channel (**58pt** list — corrected from
  56pt, see §3.1 — 100pt profile hero, corrected from an original ~96–120pt
  range); **squircle reserved exclusively for Community identity** — never use
  the squircle for anything else, it's the one shape-based semantic signal in
  the system. Stacked/fanned "ghost card" treatment (§3.1) only ever appears
  behind a squircle (communities) or, Togather-specific, a multi-channel group
  cluster's lead avatar.
- **Fallback avatars (no photo): muted per-entity pastel, never brand green.**
  A photo-less avatar gets a light, low-saturation disc (a fixed 14-hue wheel —
  clay, apricot, sand, olive, moss, teal, sky, steel blue, periwinkle, iris,
  violet, orchid, rose, dusty pink) with darker same-hue initials, hashed
  deterministically per entity id so the same entity always lands on the same
  disc. WhatsApp green and iOS destructive red are excluded from the wheel
  entirely — a screen full of brand-green fallback avatars was one of the
  audit's kill-list items (WA-VISUAL-DELTAS S5.2). A separate hue-less neutral
  gray palette (light-gray fill, dark-gray glyph) covers non-entity structural
  discs (a channel "#" avatar, a "+N more channels" expander). See §1.3 and
  `apps/mobile/components/wa/waAvatarColor.ts`.
- **FAB:** iOS has no Android-style floating action button — WhatsApp's "FAB
  equivalent" is the filled `accent` circular header button (compose `+`, §4).
  Do not introduce a bottom-corner floating circle; it's an Android pattern and
  breaks the "indistinguishable from WhatsApp iOS" goal immediately.
- **Empty states:** centered, generous vertical whitespace, a single large
  monochrome/duotone illustration or icon (~80–120pt), 17pt semibold headline,
  15pt `text.secondary` supporting line, one primary `accent` pill button max —
  no card, no border, floats on `bg.plain`/`bg.grouped`.
- **Banners:** full-width, sits at the top of the scrolling content (there is no
  nav bar to sit below — see §4), not a card (no rounded corners,
  edge-to-edge), single accompanying leading icon or none, dismiss `×` at trailing
  edge if dismissible, background is a light neutral (`bg.card`-ish) or a status
  tint (never brand-accent fill unless it's genuinely a "success/confirmed" banner)
  — e.g. "Protect your account / Log in with Face ID" in the You-tab screenshot
  uses a plain white card with a small colored (semantic green) shield icon, not a
  brand-tinted banner background.

---

## 7. The "Plus" Rules — how Togather-only elements must dress

**The governing rule:** any new Togather element must be expressible as one of the
four vocabulary primitives already defined above — **row** (§3.1/3.2), **inset-grouped
cell** (§3.2), **bubble/in-thread card** (§5), or **pill** (badges/chips as specced in
§3.1, §5, §6). If a design can't be described using those primitives, it's wrong for
this surface, not a signal to invent a fifth primitive.

**Explicitly banned, with the receipt:** `a91c868c-IMG_1243.png` (Togather's current,
pre-redesign chats list) shows the anti-pattern this spec exists to kill — pastel
taxonomy chips ("Announcements" purple, "Team" teal, "Table" lavender, "Public Group"
coral pill labels floating at the row's trailing edge), tree-line (`└`) indentation
for sub-rows, and shield badges glued onto avatar corners. **None of this survives
the redesign.** Concretely:

- **Never cards-with-shadows** as a generic container — WhatsApp's only "elevated"
  surfaces are inset-grouped cells (flat, no shadow beyond the system-default
  hairline) and message bubbles (a genuine, specific 1px soft shadow, §1.6). A
  shadowed rounded-rect "feature card" floating in a list is an Android/Material
  pattern, not this one.
- **Never colored category chips** as a taxonomy device (the "Announcements /
  Team / Table / Public Group" pattern above). If a row needs to communicate its
  type, do it the way WhatsApp does: shape (squircle vs. circle avatar), an icon
  in the row's leading position, or plain descriptive text in the subtitle line —
  never a colored pill sitting where WhatsApp puts a timestamp/badge.
- **Resources** → flat rows, WhatsApp-style: 78pt row height (§3.1), leading **small
  circular icon** (not a squircle, not a colored-square icon chip — a plain
  circular icon matching avatar geometry, ~40pt, single flat icon glyph, neutral
  or `accent`-tinted background circle used sparingly, e.g. one per resource
  *type* at most, not one arbitrary color per resource), title + one-line
  description, trailing chevron. Lives inside an inset-grouped card if it's a
  fixed list (Group info → Resources), or as full-bleed rows if it's a scrollable
  index.
- **Event cards inside chat** → rendered as **bubble-shaped cards**, i.e. they
  inherit bubble geometry (§5: same corner radii, same max-width, same
  tail-on-first-bubble-of-run rule) with structured content inside instead of
  free text: date/time block, location line, a thumbnail if present, and an
  **RSVP pill row** docked at the bubble's bottom edge (not floating outside it).
  This matches the existing precedent already visible in the announcement
  screenshots (📅/📍/🎟 emoji-led lines inside a plain text bubble) — formalize
  that into a structured card that's still visually a bubble, never a
  separate "attachment card" component with its own shadow/border language.
- **RSVP chips** → pill shape (§3.1/§5 pill vocabulary), text-only or icon+text,
  minimal fill: unselected = `bg.card` with a 1px `separator`-colored border;
  selected = `accent`-filled (or, for a neutral "Can't go" state, keep it
  outlined/neutral — don't invent a red/orange semantic chip family just because
  it's easy; if a genuine negative-state color is needed use `destructive`, not a
  new hue).
- **Prayer / Serving cards on the community page** → **inset-grouped cells**
  (§3.2), not standalone "cards." They live inside the Community-page's card
  stack exactly like "Media, links and docs" or "Chat theme" do: icon (plain,
  monochrome) + title + optional value label ("3 requests today", "You're
  rostered Sunday") + chevron. No custom card component, no shadow, no unique
  corner radius — they're rows in the same grouped list as everything else on
  that screen.

---

## 8. Per-surface checklist

Use this table as a PR-review gate for each surface. Every row's "must-match" items
should be visually verifiable against this doc (or the source screenshots) before
merging.

| Surface | Must-match items |
|---|---|
| **Chats list** | No opaque nav bar — floating ⋯/camera/`+` circles (44pt) over content, `+` the only filled-accent one · large title 34pt Heavy below the circles + 44pt search pill below that · 78pt rows · 58pt avatars (squircle for communities w/ chevron-in-badge, circle otherwise) · unread badge = `accent` fill, white numeral · unread timestamp = `accent` 15pt, read timestamp = `text.tertiary` · fallback avatars = muted per-entity pastel, never brand green · WA relative timestamp format (`3:42 PM` / `Yesterday` / weekday / `M/D/YY`) · floating island tab bar, neutral ink, no color on the active tab |
| **Chat room** | Cream wallpaper w/ tone-on-tone doodles, visible through a transparent message-list container · bubble corner radii (18pt/4pt tail) + tail-on-first-of-run, max-width 75% · outgoing = HSL-pinned `accent` tint (L 90–93 light), incoming = white/`bg.card` · sender-name fixed 6-hue neutral palette (not accent) · read ticks = WhatsApp-blue, never accent · day pills solid (not translucent), sticky · floating back circle w/ unread count · composer: translucent bar, no hairline, plain `⊕` (no circle) → pill input w/ KLIPY-gated sticker glyph → camera/mic (empty-field only) → accent send-morph |
| **Community page** | `bg.grouped` background, hero + segmented control (Community/Announcements) · action row (Add Members/Groups/Search) = **white rounded action cards**, not accent-icon circles · "Groups you're in" / "Groups you can join" as ~20pt sentence-case section headers, not ALL-CAPS chips · Prayer/Serving/Admin as inset-grouped cells (24pt radius, 54pt rows), not custom cards |
| **Group info** | Floating back circle + centered floating title (no opaque bar) · Hero (100pt avatar, 28pt bold name, member count) · white action cards (Invite/Share/Search) · Mute toggle (native `UISwitch`, accent-on) · 24pt black monochrome row icons, vertically centered chevrons, no colored icon chips · red "Leave group" as last, unbordered, no-icon row |
| **Channel info** | Same inset-grouped shape as Group info · Mute toggle first · leader-only rows visually identical to member rows (role-gating is logic, not a different visual style) · red "Leave channel" convention |
| **Directory (channel/group finder list)** | Full-bleed rows matching §3.1 geometry (78pt/58pt) even though content is discovery, not chat · "Join"/"Request to join" renders as an accent pill button trailing the row, not a chip |
| **You tab** | **No large title** — floating buttons only (search left, QR+edit right) · `bg.grouped` background · profile hero (100pt avatar + 28pt bold name, centered) · stacked inset-grouped cards below (24pt radius, 54pt rows), sentence-case or no section labels · no colored icon backgrounds anywhere on this screen |
| **Events** | Floating neutral-white circle buttons (no stray green-filled one) · sentence-case gray section headers (not ALL-CAPS "MY EVENTS") · RSVP chips per §7 pill rules (accent-filled selected, outlined unselected) · event list rows follow §3.1/§3.2 row geometry (78pt/58pt full-bleed, or 24pt-radius/54pt grouped) · centered chevrons · never a shadowed "event card" component |
| **Compose sheet** | Centered "New chat" 17pt semibold title + X-in-circle dismiss (not a "Cancel" text button) · community members list immediately, no search-first empty state · Drag handle · accent-colored creation-action icons (New group/community/broadcast) vs. neutral icons elsewhere · "Frequently contacted" section below the fixed actions, plain 78pt/58pt rows |
| **Invite kit** | QR/poster surfaces are the one place a full-bleed branded visual is appropriate (it's a printable artifact, not in-app chrome) — but any in-app *row* that launches it (e.g. "Invite your church") must still be a plain inset-grouped row, accent icon only, per §3.2 |

---

## Appendix — source screenshots referenced

| File | What it shows | Used for |
|---|---|---|
| `efe1bc47-IMG_1223.png` / `975607b1-IMG_1223.png` | Chats list, communities + DMs mixed | §3.1 row anatomy, badge/timestamp accent rule |
| `9d25a053-IMG_1224.png` / `a78a1684-IMG_1224.png` | Community page (Announcements, groups you're in/can join) | §3.2 quick-actions, §4 back-button-black rule, mute+badge coexistence |
| `f6faf237-IMG_1225.png` | Announcement thread — day pills, event-shaped text, footer note | §5 day pills, §7 event-card precedent, §5 footer note copy |
| `8f9c522d-IMG_1226.png` / `7b162302-IMG_1227.png` | Community info grouped list, incl. destructive/accent action rows | §3.2 row variants, §1.4 destructive rows, plain-icon rule |
| `0bc215fc-IMG_1231.png` / `9908c84a-IMG_1231.png` | Chat thread w/ wallpaper + bubbles ("Bridal Party Logistics") | §5 bubble geometry, reply-quote bar, link color, read ticks |
| `ba534969-IMG_1229.png` / `0f8501b1-IMG_1229.png` | You/Settings tab | §3.2, §6 avatar hero, banner styling |
| `3d337108-IMG_1232.png` | Chat theme screen (Themes gallery + Customize) | §1.5 wallpaper, §6 theme picker shape |
| `89a1631c-IMG_1233.png` | New chat sheet | §6 sheet anatomy, §1.3 accent-vs-neutral icon split |
| `31fd089d-IMG_1230.png` | You tab, second half (Account/Privacy/Chats/Appearance…) | §3.2 plain-icon confirmation |
| `a91c868c-IMG_1243.png` | **Togather's current pre-redesign chats list** | §7 banned-pattern reference (pastel chips, tree-line indent, shield badges) |
| `fe1efef0-IMG_1242.png` | Togather staging feature-flags admin screen | Confirms the `whatsapp-shell` flag name already in use (README §9.5) — no design content |
