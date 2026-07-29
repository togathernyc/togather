/**
 * WhatsApp-shell metrics — named constants for every measurement in
 * `docs/plans/church-migration-ui-redesign/WHATSAPP-DESIGN-SYSTEM.md`.
 *
 * Surface agents building flag-on screens should import these instead of
 * re-typing raw numbers, so every surface shares one rhythm. Values are the
 * spec's pt values verbatim; per the spec's own framing, "treat pt values as
 * calibrated guidance for rhythm and proportion, not pixel law."
 *
 * Where the spec gives a range (e.g. "52-64pt", "36-40pt"), the constant here
 * picks a single representative value (documented per-constant) — components
 * that need the full range still accept overrides via props.
 */

// --- §3.1 Full-bleed chat rows -----------------------------------------------

/** Row height with a 2-line preview present. */
export const WA_ROW_HEIGHT = 76;
/** Row height when there's no preview text (title-only row). */
export const WA_ROW_HEIGHT_NO_PREVIEW = 60;
/** List avatar size — circular for people/groups/channels. */
export const WA_AVATAR_LG = 56;
/** Squircle corner radius at `WA_AVATAR_LG` size — communities only (§6). */
export const WA_AVATAR_SQUIRCLE_RADIUS = 18;
/** Leading padding from screen edge to avatar. */
export const WA_ROW_LEADING_PADDING = 16;
/** Gap between avatar and the text column. */
export const WA_ROW_AVATAR_GAP = 12;
/** Trailing padding from the text column edge to the screen edge. */
export const WA_ROW_TRAILING_PADDING = 16;
/** Fixed width of the right column (timestamp + badge), right-aligned. */
export const WA_RIGHT_COLUMN_WIDTH = 60;
/** Vertical gap between the timestamp and the badge/mute-icon below it. */
export const WA_RIGHT_COLUMN_GAP = 4;
/** Unread badge minimum diameter (grows horizontally past 2 digits). */
export const WA_BADGE_MIN_DIAMETER = 20;
/** Unread badge minimum horizontal padding once it grows past a circle. */
export const WA_BADGE_MIN_H_PADDING = 8;
/** Muted bell-slash glyph size. */
export const WA_MUTED_GLYPH_SIZE = 14;
/**
 * Separator inset so the hairline starts at the text column, not the avatar:
 * `WA_ROW_LEADING_PADDING + WA_AVATAR_LG + WA_ROW_AVATAR_GAP` = 16+56+12.
 */
export const WA_SEPARATOR_INSET = WA_ROW_LEADING_PADDING + WA_AVATAR_LG + WA_ROW_AVATAR_GAP; // 84
/** Diagonal offset of each "ghost" stacked-card edge behind a community/cluster avatar. */
export const WA_GHOST_CARD_OFFSET = 4.5;

// --- §3.2 iOS inset-grouped lists --------------------------------------------

/** Inset-grouped card corner radius. */
export const WA_GROUP_RADIUS = 10;
/** Card horizontal margin from the screen edge. */
export const WA_GROUP_MARGIN = 16;
/** Cell minimum height (single-line, iOS tap-target floor). */
export const WA_CELL_MIN_HEIGHT = 44;
/** Cell minimum height when it wraps a description/footnote sub-line. */
export const WA_CELL_TALL_MIN_HEIGHT = 52;
/** Cell maximum height when it wraps a description/footnote sub-line. */
export const WA_CELL_TALL_MAX_HEIGHT = 64;
/** Cell horizontal padding inside the card. */
export const WA_CELL_PADDING = 16;
/** Monochrome glyph icon size inside a cell (no colored background chip). */
export const WA_CELL_ICON_SIZE = 21;
/** Fixed icon column width inside a cell. */
export const WA_CELL_ICON_COLUMN = 28;
/**
 * Gap between the icon column and the label text. Spec: "20pt leading
 * padding before the label starts (icon column is a fixed ~28pt)" — read as
 * the icon→label gap, distinct from `WA_CELL_PADDING` (the card's own
 * leading/trailing inset).
 */
export const WA_CELL_ICON_LABEL_GAP = 20;
/** Chevron glyph size. */
export const WA_CHEVRON_SIZE = 13;
/** Gap between a value label and its trailing chevron. */
export const WA_CHEVRON_GAP = 8;
/** Gap between a section header and the card below it. */
export const WA_SECTION_HEADER_GAP = 8;
/** Vertical spacing between grouped cards (visibly more generous than the header-to-card gap). */
export const WA_GROUP_SPACING = 28;
/** Segmented control height (e.g. "Community" / "Announcements"). */
export const WA_SEGMENTED_HEIGHT = 36;
/** Quick-action circular icon size (Add Members / Add Groups / Search). */
export const WA_QUICK_ACTION_CIRCLE = 38;

// --- §4 Navigation chrome -----------------------------------------------------
//
// Calibrated against the owner's current-WhatsApp-iOS reference screenshots
// (see WA-VISUAL-DELTAS.md S1/S2): iOS 26 design language — floating circular
// buttons over the scrolling content instead of opaque nav bars, and a
// floating rounded-island tab bar instead of an edge-to-edge one.

/** Large title font size (at rest, leading-aligned). */
export const WA_LARGE_TITLE_SIZE = 34;
/** Collapsed nav title font size (centered, on scroll). */
export const WA_NAV_TITLE_SIZE = 17;
/** Circular header button diameter (⋯ / camera / compose +). */
export const WA_HEADER_CIRCLE_SIZE = 44;
/** Gap between adjacent header circles. */
export const WA_HEADER_CIRCLE_GAP = 10;
/** Icon size centered inside a header circle. */
export const WA_HEADER_ICON_SIZE = 22;
/** Search pill height (fully rounded, radius = height/2). */
export const WA_SEARCH_PILL_HEIGHT = 44;
/** Search pill magnifying-glass icon size. */
export const WA_SEARCH_PILL_ICON_SIZE = 17;
/** Gap between the search pill's icon and placeholder text. */
export const WA_SEARCH_PILL_ICON_GAP = 8;
/** Search pill margin from each screen edge. */
export const WA_SEARCH_PILL_MARGIN = 16;
/** Gap between the large title and the search pill below it. */
export const WA_SEARCH_PILL_TOP_GAP = 12;

// --- S1 Floating chrome (buttons + shadows) ----------------------------------

/**
 * Floating button shadow — deliberately very light. The reference's circles
 * read as "lifted paper", not as material cards: a 8px blur at 8% black.
 * Expressed as RN shadow props (never a web-only `boxShadow` string) so it
 * renders on iOS, Android (`elevation`) and RN-Web alike.
 */
export const WA_FLOATING_SHADOW = {
  shadowColor: '#000000',
  shadowOpacity: 0.08,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 3,
} as const;
/** Slightly deeper lift for the tab-bar island (it sits over live content). */
export const WA_ISLAND_SHADOW = {
  shadowColor: '#000000',
  shadowOpacity: 0.12,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 4 },
  elevation: 8,
} as const;
/** Vertical gap between the floating-button row and the large title below it. */
export const WA_FLOATING_ROW_TITLE_GAP = 10;

// --- S2 Floating island tab bar ----------------------------------------------

/** Island height (the pill itself, excluding its margins/safe inset). */
export const WA_TAB_ISLAND_HEIGHT = 64;
/** Island corner radius — fully rounded at `WA_TAB_ISLAND_HEIGHT`. */
export const WA_TAB_ISLAND_RADIUS = WA_TAB_ISLAND_HEIGHT / 2;
/** Island inset from each screen edge. */
export const WA_TAB_ISLAND_MARGIN_H = 10;
/** Gap between the island's bottom edge and the bottom safe inset. */
export const WA_TAB_ISLAND_BOTTOM_GAP = 8;
/**
 * Island fill — near-white, only just translucent. WhatsApp's island is a real
 * blur, so content passing under it is diffused into a wash; an rgba fill can't
 * blur, and at the 0.92 we first tried, rows stayed fully legible through the
 * island (a muddy double-image the reference never shows). Erring opaque is the
 * closer approximation.
 */
export const WA_TAB_ISLAND_FILL_LIGHT = 'rgba(255,255,255,0.97)';
/** Dark-mode island fill. */
export const WA_TAB_ISLAND_FILL_DARK = 'rgba(31,44,52,0.97)';
/** Tab bar icon size (outline; filled variant when active). */
export const WA_TAB_ICON_SIZE = 24;
/** Gap between a tab's icon and its label. */
export const WA_TAB_LABEL_GAP = 2;
/** Tab label font size. */
export const WA_TAB_LABEL_SIZE = 10;
/**
 * Every tab glyph + label is this neutral ink — active AND inactive. The green
 * active tint was the loudest "not WhatsApp" signal in the audit (S2.2); the
 * active tab is marked by the highlight pill below, never by hue.
 */
export const WA_TAB_INK_LIGHT = '#0A0A0A';
/** Dark-mode tab ink. */
export const WA_TAB_INK_DARK = '#E9EDEF';
/**
 * Highlight pill (wrapping icon+label) behind the active tab: a LIGHT gray,
 * a clear step darker than the near-white island but still unmistakably light,
 * with the glyph and label staying near-black on top of it. A 6%-black alpha
 * landed around #EFEFEF — too faint to read as a pill at all.
 */
export const WA_TAB_ACTIVE_PILL_LIGHT = '#E3E3E8';
/** Dark-mode active highlight pill — a step LIGHTER than the island, near-white glyph on top. */
export const WA_TAB_ACTIVE_PILL_DARK = 'rgba(255,255,255,0.16)';
/** Active highlight pill corner radius. */
export const WA_TAB_ACTIVE_PILL_RADIUS = 18;
/** Tab badge offset (top-right of the icon). */
export const WA_TAB_BADGE_OFFSET = -4;
/** You-tab avatar glyph size (falls back to a person icon when no photo). */
export const WA_TAB_AVATAR_SIZE = 24;

/**
 * Height of the strip BELOW the island — the bottom safe inset plus the
 * island's gap. A flag-on screen reserves this as padding on the container
 * that carries its page background, so that strip paints as page background
 * instead of live list content: the island is absolutely positioned and takes
 * no layout space, so without this the scroll viewport runs to the screen edge
 * and rows show in the gap under the island (which reads as a dirty band, and
 * on a white page as an outright dark one when a dark avatar lands there).
 */
export function waTabBarStripHeight(bottomInset: number): number {
  return bottomInset + WA_TAB_ISLAND_BOTTOM_GAP;
}

/**
 * Bottom padding for a scroll surface whose container already reserves
 * `waTabBarStripHeight` — enough for the last row to clear the island itself.
 */
export const WA_TAB_CONTENT_CLEARANCE = WA_TAB_ISLAND_HEIGHT + 12;

// --- S7 Typography scale ------------------------------------------------------
//
// One scale for every flag-on surface (WA-VISUAL-DELTAS.md S7). Togather's
// pre-pass sizes ran 1–2pt small and one weight light throughout; import these
// rather than re-typing `fontSize: 17`.

/** 34 heavy — screen large title ("Chats"). */
export const WA_TYPE_LARGE_TITLE = 34;
/** 28 bold — profile/entity hero name. */
export const WA_TYPE_HERO_NAME = 28;
/** 22 bold — screen header block (community landing name). */
export const WA_TYPE_HEADER_BLOCK = 22;
/** ~20 semibold gray — landing section headers ("Groups you're in"). */
export const WA_TYPE_SECTION_HEADER = 20;
/** 17 semibold — list row titles / 17 regular — grouped cell labels. */
export const WA_TYPE_ROW_TITLE = 17;
/** 16 — chat bubble body. */
export const WA_TYPE_BUBBLE_BODY = 16;
/** 15 — row subtitles / previews. */
export const WA_TYPE_SUBTITLE = 15;
/** 13 — footers, day pills. */
export const WA_TYPE_FOOTNOTE = 13;
/** 11 — in-bubble timestamps. */
export const WA_TYPE_MICRO = 11;

/** Large-title weight — SF Heavy-ish. */
export const WA_WEIGHT_LARGE_TITLE = '800' as const;
/** Hero-name / header-block weight. */
export const WA_WEIGHT_BOLD = '700' as const;
/** Row-title / nav-title weight. */
export const WA_WEIGHT_SEMIBOLD = '600' as const;
/** Body / cell-label weight. */
export const WA_WEIGHT_REGULAR = '400' as const;

// --- §5 Chat screen -------------------------------------------------------

/** Bubble max width as a fraction of screen width. */
export const WA_BUBBLE_MAX_WIDTH_PCT = 0.78;
/** Bubble corner radius on the three "open" corners. */
export const WA_BUBBLE_RADIUS = 18;
/** Corner radius at the sender-origin corner on the first bubble of a run (the "tail" corner). */
export const WA_BUBBLE_TAIL_CORNER_RADIUS = 4;
/** Bubble internal vertical padding. */
export const WA_BUBBLE_PADDING_V = 10;
/** Bubble internal horizontal padding. */
export const WA_BUBBLE_PADDING_H = 12;
/** Horizontal margin from the screen edge / avatar to the bubble. */
export const WA_BUBBLE_MARGIN = 8;
/** Vertical gap between consecutive bubbles in the same run (tail dropped). */
export const WA_BUBBLE_GROUPED_GAP = 2;
/** Vertical gap between different senders/runs. */
export const WA_BUBBLE_RUN_GAP = 9;
/** Day pill vertical padding. */
export const WA_DAY_PILL_PADDING_V = 6;
/** Day pill horizontal padding. */
export const WA_DAY_PILL_PADDING_H = 14;
/** Fraction a reaction chip overlaps its bubble's bottom-outer corner. */
export const WA_REACTION_CHIP_OVERLAP_PCT = 0.4;
/** Reply-quote bar left-border strip width. */
export const WA_REPLY_QUOTE_BORDER_WIDTH = 3;
/** Reply-quote thumbnail size. */
export const WA_REPLY_QUOTE_THUMB_SIZE = 28;
/** Composer pill input minimum height (grows with content). */
export const WA_COMPOSER_MIN_HEIGHT = 36;

// --- §6 Components ----------------------------------------------------------

/** Sheet top corner radius. */
export const WA_SHEET_RADIUS = 16;
/** Sheet drag-handle bar width. */
export const WA_SHEET_HANDLE_WIDTH = 36;
/** Sheet drag-handle bar height. */
export const WA_SHEET_HANDLE_HEIGHT = 5;
/** Gap from the top of the sheet to the drag handle. */
export const WA_SHEET_HANDLE_TOP_GAP = 8;
/** Sheet circular dismiss (×) button diameter. */
export const WA_SHEET_DISMISS_SIZE = 36;
/** Native `UISwitch`-geometry toggle width. */
export const WA_TOGGLE_WIDTH = 51;
/** Native `UISwitch`-geometry toggle height. */
export const WA_TOGGLE_HEIGHT = 31;
/** Profile-hero circular avatar size. */
export const WA_AVATAR_PROFILE = 108;
/** Empty-state illustration/icon size. */
export const WA_EMPTY_STATE_ICON_SIZE = 100;

/**
 * Fallback accent used by `components/wa/*` when a caller doesn't pass an
 * explicit `accent` prop (these components read `useTheme()` for neutral
 * grays but never call `useCommunityTheme()` themselves — see each
 * component's JSDoc). WhatsApp's own default green, per §1.1.
 */
export const WA_DEFAULT_ACCENT = '#25D366';
