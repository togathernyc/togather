# WhatsApp iOS Design System — Togather "WhatsApp Plus" Spec

**Status:** source of truth for implementation. **Audience:** the ~10 agents building
the `whatsapp-shell` flag-on UI (see [README.md §9.5](./README.md#95-rollout--everything-behind-one-flag)).

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

Every value below was measured off the real WhatsApp iOS screenshots in
`/root/.claude/uploads/66d31337-e89d-55e2-88f5-71fb939383a6/` (1320px-wide capture,
i.e. an iPhone Pro-class screen at 3x — divide px by 3 for pt) and cross-checked
against known WhatsApp iOS conventions. **Treat pt values as calibrated guidance for
rhythm and proportion, not pixel law** — match the *relationships* (avatar-to-row-height
ratio, badge-to-timestamp alignment, section gap vs. card corner radius) over chasing
an exact pixel.

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
| `bg.navBar` | `#FFFFFF` (opaque) / translucent-white on scroll-under | All nav bars — **not** WhatsApp's legacy teal header; current WhatsApp iOS uses a flat white bar |
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
| `bg.navBar` | `#1F2C34` (opaque) / translucent-dark on scroll-under | Nav bars |
| `separator` | `#2A3942` | Dividers |
| `text.primary` | `#E9EDEF` | Titles, bubble text |
| `text.secondary` | `#8696A0` | Previews, footnotes |
| `text.tertiary` | `#667781` | Read timestamps, placeholders |
| `accent` (brand) | community `primaryColor`, luminance-adjusted for AA contrast on `#000000`/`#1F2C34` (WhatsApp's own dark accent is `#00A884`, a brighter/desaturated shift off its light-mode `#25D366` — apply the same shift formula to any community brand color) | Same roles as light |
| `destructive` | `#FF453A` (iOS dark-mode red) | Same rows |
| `mention.blue` | `#53BDEB`-ish (WhatsApp's dark-mode link/mention blue) | Same roles, neutral |

**Dark-mode accent rule:** never reuse the light-mode brand hex verbatim in dark mode.
WhatsApp shifts `#25D366` → `#00A884` (higher lightness, slightly desaturated) purely
for AA contrast on near-black surfaces. Apply an equivalent HSL lightness/saturation
adjustment to each community's `primaryColor` rather than hard-coding two brand colors
per community.

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
| Outgoing chat bubble fill | **Yes**, as a **light tint** of `primaryColor` (≈15–20% mix onto white; WhatsApp's own `#D9FDD3` is roughly `#25D366` at ~18% opacity over white) — **not** the full-saturation brand color | Full-saturation brand color on a bubble reads too loud; WhatsApp never does this |
| In-message/in-bubble URL links | **Yes** | Underlined, `accent` color |
| Toggle "on" track color | **Yes** | |
| New-chat-sheet action icons (New group/community/broadcast) | **Yes** | These are creation affordances, matching the FAB |
| Action-sheet-style green text rows (Add to Favorites, Export chat, Add to list) | **Yes** | Left-aligned, no icon, no chevron — see §3.3 |
| Active/selected tab icon+label (bottom tab bar) | **Yes** | Inactive tabs use `text.tertiary` |
| "Going"/RSVP-affirmative semantic states *if* reusing WhatsApp's own green-for-positive convention | **Yes, but see §7** | Only when the state literally means "confirmed/positive" — don't brand-color RSVP chips just for prettiness |
| Community/group avatar ring or default placeholder tint | **Yes** | Absent a photo, initials avatars use `accent` background |
| — | | |
| Back chevron + back-button label (WhatsApp shows unread-count-as-label, e.g. "‹ 62") | **No — stays `text.primary` black** | WhatsApp deliberately overrides iOS's default blue back button to neutral black. Do not brand this. |
| Settings/info-screen leading icons (Media, Storage, Notifications, Chat theme, Lock chat, Encryption, etc.) | **No — stays `text.primary`/`text.secondary` black-gray, plain glyph, no colored background chip** | This is the single most common mistake: do NOT port iOS Settings-app's colored-rounded-square icon treatment. WhatsApp's own info screens use flat monochrome glyphs, no icon backgrounds at all. |
| Sender name colors in group chats / @mention text | **No — fixed neutral rotating palette** | See §5; a deterministic per-sender palette (blue, orange, teal, purple, pink, olive…) unrelated to brand color. Never recolor these to `primaryColor`. |
| Destructive red rows (Exit community, Report, Clear chat, Delete) | **No — stays system red**, see §1.1 | |
| Nav bar background, large title text, row title text | **No — stays neutral white/black** | WhatsApp's nav chrome is deliberately colorless; only the *accents floating on it* (buttons, badges) carry brand color |
| Chat wallpaper doodle pattern | **No — stays neutral beige/cream tone-on-tone**, unless the community explicitly picks a themed wallpaper (§1.5) | |
| Read-receipt double-check marks | **No.** Delivered = gray double-check. Read = **WhatsApp-blue** double-check (`#34B7F1`-ish), never brand-colored | This is WhatsApp's single most recognizable non-green color signal — don't touch it |
| Muted-chat bell-slash glyph | **No — neutral gray** | |

### 1.4 Destructive red

Never brand-mapped (see table above). Used for: `Exit community` / `Exit group` /
`Leave channel`, `Delete chat` / `Clear chat`, `Report announcements` / `Report`,
`Remove member`, `Delete message`. Two renderings:

- **Inline grouped-list row** (Community info style): left-aligned red text, 17pt
  regular, no leading icon, no chevron, same 44–52pt row height as neutral rows in
  the same card.
- **Modal/action-sheet row** (native `UIAlertController`/action-sheet destructive
  action): centered red text, 20pt regular, full-width row, own card, no icon.

### 1.5 Chat wallpaper & doodle treatment

Default wallpaper: warm beige/cream (`#ECE5DD` light / `#0B141A` dark) with a **very
low-contrast tone-on-tone doodle pattern** — hand-drawn line-art icons (flowers, mugs,
game controllers, keys — generic, non-thematic) tiled at low opacity (~8–12%),
same hue family as the base so it reads as texture, not imagery. Confirmed directly
in the screenshots (`0bc215fc`/`9908c84a`): the pattern sits *behind* every bubble and
day pill, never interferes with text contrast.

Togather mapping: default wallpaper stays this neutral beige/dark tone — **do not
tint the wallpaper with `primaryColor`.** The WhatsApp "Chat theme" screen (§6) lets
a user pick from a curated wallpaper+bubble-color gallery; Togather's community-level
equivalent (P2 per README §11.5) would let an admin pick a *curated* wallpaper for
the community's default theme, but the out-of-the-box default must stay neutral so
the accent substitution rule (bubble-tint-only) still reads clearly.

### 1.6 Incoming vs. outgoing bubble colors

| | Light | Dark |
|---|---|---|
| Incoming bubble | `#FFFFFF`, subtle drop shadow (`0 1px 0.5px rgba(0,0,0,0.08)`) | `#1F2C34` |
| Outgoing bubble | `accent` at ~18% mix over white (WhatsApp's `#D9FDD3`) | `accent`-derived dark teal-green (WhatsApp's `#005C4B`) — a *saturated dark* tint, not a light tint, because dark-mode outgoing bubbles need to read as "filled," not "washed out" |
| Bubble text | `text.primary` in both — bubble fill never gets dark enough/light enough to need inverted text | `text.primary` |

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

| Role | Size / Weight | Color | Used |
|---|---|---|---|
| Large title | 34pt Bold | `text.primary` | "Chats", community name on Community info hero (slightly smaller, see below) |
| Nav title (collapsed) | 17pt Semibold | `text.primary` | Centered title once large title scrolls away |
| Row title (chat/group name) | 17pt — **Semibold when unread, Regular when read** | `text.primary` | Chat list row primary line |
| Row subtitle / message preview | 15pt Regular (**Semibold** only for the "you're mentioned" bold-preview state) | `text.secondary` (read) | Chat list row second line |
| Timestamp (row) | 13pt Regular | `accent` if unread, `text.tertiary` if read | Right-aligned, top of row's right column |
| Section header (grouped list) | 13pt Regular, UPPERCASE, tracking +0.5 | `text.secondary` | "Groups you're in", "Groups you can join", "Themes", "Customize" |
| Section footer | 13pt Regular | `text.tertiary` | Explanatory text under a card, e.g. "Created by…", "This chat has added privacy for your phone number. Learn more." |
| Footnote / helper text | 13pt Regular | `text.tertiary` | Sub-line under a settings row (e.g. under "Lock chat") |
| Grouped-list cell title | 17pt Regular | `text.primary` | "Media, links and docs", "Notifications" |
| Grouped-list value label | 17pt Regular | `text.tertiary` | Right-aligned value before chevron, e.g. "5.4 MB", "Off", "On" |
| Bubble text | 16pt Regular (measured ~15.5–17pt) | `text.primary` | Message body |
| Bubble sender name (group chats) | 14–15pt Semibold | Per-sender neutral palette color (§5) | First line inside an incoming bubble, group chats only |
| Bubble timestamp + ticks | 11pt Regular | `text.tertiary` on incoming; `rgba(0,0,0,0.45)`-on-tint (light) / `rgba(255,255,255,0.6)`-on-tint (dark) on outgoing | Bottom-right inside bubble, ticks immediately follow |
| Day pill | 13pt Semibold | `text.secondary` on `bg.card`-ish pill fill | "Friday", "Sat, Jul 18" |
| Composer placeholder | 17pt Regular | `text.tertiary` | Empty message input |
| Tab bar label | 10pt Medium | `accent` (active) / `text.tertiary` (inactive) | Bottom tab bar |
| Community/group member count, hero subtitle | 15pt Regular | `text.secondary` | "Community · 2 groups" |

---

## 3. List Anatomy

### 3.1 Full-bleed chat rows (Chats list, New-chat contact list)

- **Row height:** 76pt (2-line preview present); 60pt if a row has no preview text.
- **Avatar:** 56×56pt. Circular for people/groups/channels. **Rounded-square
  ("squircle"), ~18pt corner radius, for Communities** — this is the one shape
  distinction in the whole system and it's load-bearing: it's the only way a user
  tells "this row opens a community" from "this row opens a chat" at a glance.
- **Leading padding:** 16pt from screen edge to avatar.
- **Avatar-to-text gap:** 12pt.
- **Trailing padding:** 16pt from text column edge to screen edge.
- **Right column** (timestamp + badge), fixed-width ~60pt, right-aligned, stacked
  vertically: timestamp on top, badge/mute-icon below it, ~4pt gap.
- **Unread badge:** filled `accent` capsule/circle, min 20pt diameter (grows
  horizontally past 2 digits, min 8pt horizontal padding), white bold 12pt numeral,
  right-aligned under the timestamp.
- **Muted indicator:** small gray bell-slash glyph (~14pt), sits left of (or in place
  of, if no unread) the badge position — badge itself stays `accent`-colored even
  when muted; only the bell-slash communicates mute state (confirmed in
  `a78a1684-IMG_1224.png`: "P&P Community Members 1B" shows a bell-slash **and** a
  still-green "2" badge).
- **Separator:** 0.5–1px hairline, **inset to align with the text column** (starts
  at `leading padding + avatar width + gap` = 16+56+12 = **84pt** from the left edge,
  full-bleed to the right edge). Full-width separators (no inset) only appear before
  section-starting utility rows like "Archived."
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
- **Card corner radius:** 10pt (standard iOS `insetGrouped` radius — screenshots
  read as 10–14pt; default to 10pt for consistency with system components).
- **Card horizontal margin:** 16pt from screen edge.
- **Cell height:** 44pt minimum (single-line, iOS tap-target floor); 52–64pt when a
  cell wraps a description/footnote sub-line (e.g. "Lock chat" with its explanatory
  text, or the phone-number-privacy row).
- **Cell horizontal padding:** 16pt leading/trailing inside the card.
- **Icon treatment: plain, flat, monochrome glyph — no colored rounded-square
  background chip.** This is a deliberate departure from Apple's own Settings app
  (which uses colored icon badges) and must be followed exactly: icons are simple
  SF Symbols-style outlines in `text.primary`/`text.secondary`, sized ~20–22pt,
  20pt leading padding before the label starts (icon column is a fixed ~28pt).
- **Chevron:** `chevron.right`, 13pt, `text.tertiary`, trailing edge, 8pt gap from
  any value label.
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
- **Section headers:** sit *above* their card, outside the white fill, 13pt
  uppercase gray, 16pt leading padding matching the card margin, ~8pt gap to the
  card below.
- **Section footers:** sit *below* their card, same margin, 13pt gray, wraps to
  multiple lines freely (e.g. "Created by +44 7581 068048. Created Jul 27, 2024.").
- **Spacing between groups (cards):** ~24–32pt — visibly more generous than the
  header-to-card gap (~8pt), so cards read as discrete clusters, not one long list.
- **Tab-style segmented control** (seen atop Community info: "Community" /
  "Announcements"): full-width, ~36pt tall, rounded-rect selector, `bg.grouped`
  track, white/`bg.card` selected pill, sits between the hero and the first card,
  no card wrapper of its own.
- **Quick-action row above the cards** (Community info's "Add Members / Add Groups /
  Search"): 3-up equal-width unbordered buttons, each a small circular
  accent-colored icon (36–40pt circle, `accent`-tinted icon, no filled background)
  over a 13pt label, no card container — floats directly on `bg.grouped`.

### 3.3 Red/destructive rows & centered action rows

Covered in §1.4 — repeated here for the list-anatomy context: destructive rows never
carry a leading icon or trailing chevron in either the inline-grouped or
action-sheet-centered variant, distinguishing them from every other row type at a
glance (icon+chevron = navigate; plain colored text = irreversible/singular action).

---

## 4. Navigation Chrome

- **Large-title pattern:** standard iOS `UINavigationController` large-title
  behavior — 34pt bold title sits below the nav bar at rest, collapses into a 17pt
  semibold centered title as the user scrolls, with the large title's leading
  alignment (never centered at rest).
- **Header buttons above the large title** (not inline with a title): WhatsApp
  floats its utility buttons in their own row *above* "Chats", not flanking it —
  `⋯` (more) at leading edge, camera + compose `+` at trailing edge. Circular
  buttons: 40pt diameter, `bg.grouped`-ish light-gray fill (white circle on white
  bg reads via a subtle 1px border/shadow, per screenshot), icon ~18pt centered,
  8pt gap between adjacent circles. The compose `+` is the one **filled `accent`**
  circle among them — everything else is neutral gray/white.
  - **Togather adaptation:** since Togather's tab bar already anchors the
    community switcher (README §5, Rule 3) at this position, treat the `⋯`
    slot as the community-switcher avatar per the existing plan; keep the
    camera/compose slots as-is.
- **Back chevron:** `chevron.left`, paired with a label — WhatsApp shows the
  *previous screen's unread count* here ("‹ 62") rather than "Back" or the screen
  title. **Both chevron and label render in `text.primary` black, never accent
  blue** (WhatsApp overrides iOS's default blue back button — see §1.3). Togather
  should show a meaningful previous-context label (e.g. community name) in the same
  neutral color, not iOS system blue and not brand accent.
- **Search pill:** 36–38pt tall, fully rounded (radius = height/2), `bg.grouped`-ish
  fill (`systemGray6`-equivalent), 15pt `text.tertiary` magnifying-glass icon,
  8pt gap to a 17pt placeholder in `text.tertiary` ("Ask Meta AI or Search" →
  Togather: "Search"), full-width minus 16pt margins each side, sits 12pt below the
  large title.
- **Tab bar:** 49pt content height + safe-area inset, 5 tabs in WhatsApp (Updates ·
  Calls · Meta AI · Chats · You), **Togather uses 4** (Chats · Events · Prayer ·
  You per README §5). Icon 25×25pt outline (filled variant when active), label
  10pt medium directly below, 2pt gap. Badge: small `accent`-filled pill,
  positioned top-right of the icon, offset ~-4/-4pt, white bold numeral ~11pt, same
  badge shape/rules as §3.1's row badge.

---

## 5. Chat Screen

- **Wallpaper:** §1.5 — neutral beige/cream tone-on-tone doodle, full-bleed behind
  the message list, persists correctly under the composer and status bar (extends
  edge-to-edge).
- **Bubble geometry:**
  - **Max width:** ~78% of screen width (leaves a consistent ~22% gutter on the
    opposite side from the avatar/tail).
  - **Corner radius:** ~18pt on the three "open" corners; the corner nearest the
    sender's origin (bottom-left for incoming, bottom-right for outgoing) is
    squared/tailed on the **first bubble in a consecutive run**, ~4pt radius there,
    full 18pt on continuation bubbles.
  - **Tail:** a small triangular/curved notch on the first bubble of a run only,
    pointing toward the avatar (incoming, left) or screen edge (outgoing, right);
    consecutive bubbles from the same sender drop the tail and tighten vertical
    gap to ~2pt (vs. ~8–10pt between different senders/runs).
  - **Bubble padding:** ~10pt vertical, ~12pt horizontal internal padding.
  - **Horizontal margin:** incoming bubbles start ~8pt right of the avatar
    (avatar only shown on the *last* bubble of an incoming run, others show blank
    avatar-width gutter); outgoing bubbles hug the trailing edge with ~8pt margin,
    no avatar (it's "you").
- **Grouping consecutive messages:** same sender + within a short time window
  (WhatsApp uses ~1 minute) collapse into one visual run: no repeated sender name,
  no repeated avatar, tightened spacing (~2pt), only the *last* bubble in the run
  shows a timestamp/ticks unless an individual bubble is tapped.
- **In-bubble timestamp + ticks placement:** bottom-right corner of the *last*
  bubble in a run, inline after the text (text reflows around it, never a separate
  line unless the message is very short/single-word, where the timestamp still
  right-aligns below). Ticks (outgoing only): single gray check = sent, double gray
  check = delivered, **double WhatsApp-blue check = read** (never brand-accent —
  §1.3).
- **Day pills:** centered, floating capsule (13pt semibold text, `bg.card`-ish
  translucent fill, ~6pt vertical/14pt horizontal padding, fully rounded), sticky
  at the top of the viewport while its day's messages are in view, otherwise
  inline between message groups ("Friday", "Fri, Jul 17", "Sat, Jul 18").
- **Sender-name colors in groups:** shown as the first line inside the *first*
  bubble of an incoming run only, 14–15pt semibold, colored from a **fixed neutral
  rotating palette** deterministically hashed per sender (observed hues: blue,
  green/olive, orange, teal, purple, pink — **not the brand accent**, per §1.3).
  1:1 chats never show a sender name.
- **Reply-quote bar:** sits atop the bubble it's attached to, inside the same
  bubble shape (not a separate element) — a ~3pt colored left-border strip
  (matching the quoted sender's assigned neutral color) + the quoted sender's name
  (same neutral color, 13pt semibold) + truncated original text (13pt, `text.secondary`,
  1 line max, ellipsis) + optional thumbnail (28×28pt) if the quoted message had
  media, all in a slightly recessed/tinted sub-region (~6% black or ~6% white mix)
  above the reply's own text.
- **Reaction chips:** small pill(s) anchored to the bottom-outer corner of a
  bubble, overlapping it by ~40%, white/`bg.card` fill with a thin border, 1px
  shadow, emoji ~13pt + count ~12pt if >1, tap to see who reacted.
- **Composer anatomy** (left to right): `+` circle (attachment picker, 28pt icon,
  no fill/neutral gray, NOT accent — it's a utility action not a "create" action)
  → rounded pill text input (min 36pt tall, grows with content, `bg.card`-ish fill,
  17pt placeholder) with a sticker/emoji glyph inset at its trailing edge inside
  the pill → camera icon (outside the pill, trailing) → mic icon (outside,
  trailing-most). **Send morph:** once text is entered, the trailing icon(s)
  collapse into a single filled `accent` circular send button (arrow-up glyph);
  clearing the text reverts to camera+mic.
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
- **Avatars:** circular for person/group/channel (56pt list, ~96–120pt profile
  hero); **squircle (≈18pt radius at 56pt size, scale proportionally) reserved
  exclusively for Community identity** — never use the squircle for anything else,
  it's the one shape-based semantic signal in the system. Stacked/fanned "ghost
  card" treatment (§3.1) only ever appears behind a squircle (communities) or,
  Togather-specific, a multi-channel group cluster's lead avatar.
- **FAB:** iOS has no Android-style floating action button — WhatsApp's "FAB
  equivalent" is the filled `accent` circular header button (compose `+`, §4).
  Do not introduce a bottom-corner floating circle; it's an Android pattern and
  breaks the "indistinguishable from WhatsApp iOS" goal immediately.
- **Empty states:** centered, generous vertical whitespace, a single large
  monochrome/duotone illustration or icon (~80–120pt), 17pt semibold headline,
  15pt `text.secondary` supporting line, one primary `accent` pill button max —
  no card, no border, floats on `bg.plain`/`bg.grouped`.
- **Banners:** full-width, sits below the nav bar, not a card (no rounded corners,
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
- **Resources** → flat rows, WhatsApp-style: 56pt row height, leading **small
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
| **Chats list** | 76pt rows · 56pt avatars (squircle for communities, circle otherwise) · separator inset at 84pt · unread badge = `accent` fill, white numeral · unread timestamp = `accent`, read timestamp = `text.tertiary` · large title 34pt bold + search pill below · header circles (⋯ / camera / `+`) above the title, `+` is the only filled-accent one |
| **Chat room** | Beige/dark neutral wallpaper w/ tone-on-tone doodles · bubble corner radii + tail-on-first-of-run · outgoing = light `accent` tint, incoming = white/`bg.card` · sender-name neutral palette (not accent) · read ticks = WhatsApp-blue, never accent · day pills sticky · composer: `+` (neutral) → pill input → camera/mic → accent send-morph |
| **Community page** | `bg.grouped` background, hero + segmented control (Community/Announcements) · quick-action row (Add Members/Groups/Search) = accent-icon-only, no fill · "Groups you're in" / "Groups you can join" as plain section-headed rows, not chips · Prayer/Serving/Admin as inset-grouped cells, not custom cards |
| **Group info** | Hero (large circular avatar, name, member count) · icon action row (Invite/Share/Search, accent icons) · Mute toggle (native `UISwitch`, accent-on) · plain monochrome row icons throughout, no colored icon chips · red "Leave group" as last, unbordered, no-icon row |
| **Channel info** | Same inset-grouped shape as Group info · Mute toggle first · leader-only rows visually identical to member rows (role-gating is logic, not a different visual style) · red "Leave channel" convention |
| **Directory (channel/group finder list)** | Full-bleed rows matching §3.1 geometry even though content is discovery, not chat · "Join"/"Request to join" renders as an accent pill button trailing the row, not a chip |
| **You tab** | `bg.grouped` background · profile hero (large circular avatar + name, centered) · stacked inset-grouped cards below, plain monochrome icons · no colored icon backgrounds anywhere on this screen |
| **Events** | RSVP chips per §7 pill rules (accent-filled selected, outlined unselected) · event list rows follow §3.1/§3.2 row geometry depending on context (full-bleed "This week" strip vs. grouped list) · never a shadowed "event card" component |
| **Compose sheet** | Drag handle + `×` dismiss · accent-colored creation-action icons (New group/community/broadcast) vs. neutral icons elsewhere · "Frequently contacted"/messaged section below the fixed actions, plain rows |
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
