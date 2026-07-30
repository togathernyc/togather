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
/**
 * Unread badge minimum horizontal padding once it grows past a circle.
 * Measured off the reference at 5pt, not the spec prose's 8: at 8 a two-digit
 * count inflated the capsule into a wide lozenge instead of WhatsApp's snug
 * one (calibrated pixel pass, 2026-07-29).
 */
export const WA_BADGE_MIN_H_PADDING = 5;
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
//
// Recalibrated against the owner's WhatsApp iOS reference screenshots
// (WA-VISUAL-DELTAS.md S3): the pre-pass values were derived from the spec
// prose and read as iOS-15 Settings, not as current WhatsApp — a 10pt radius
// on 44pt rows with thin gray 21pt glyphs. The screenshots win (see the doc's
// preamble), so these are the measured values.

/**
 * Inset-grouped card corner radius. S3.1: "~24px (Togather ~12 — visibly
 * wrong at a glance)" — the single most visible card delta in the audit.
 */
export const WA_GROUP_RADIUS = 24;
/** Card horizontal margin from the screen edge. */
export const WA_GROUP_MARGIN = 16;
/** Cell minimum height (single-line). S3.2 measures the band at 52–56pt. */
export const WA_CELL_MIN_HEIGHT = 54;
/** Cell minimum height when it wraps a description/footnote sub-line. */
export const WA_CELL_TALL_MIN_HEIGHT = 64;
/** Cell maximum height when it wraps a description/footnote sub-line. */
export const WA_CELL_TALL_MAX_HEIGHT = 76;
/** Cell horizontal padding inside the card. */
export const WA_CELL_PADDING = 16;
/**
 * Monochrome glyph icon size inside a cell (no colored background chip).
 * S3.2: "left icon 24px, **black** ~1.5px-stroke glyphs (not thin gray)" —
 * the stroke weight comes from Ionicons' `-outline` set at this size; the ink
 * is `colors.text`, which `WaCell` applies as the default (was
 * `text.secondary`, which read as the "thin gray" the audit flagged).
 */
export const WA_CELL_ICON_SIZE = 24;
/** Fixed icon column width inside a cell — exactly the glyph box. */
export const WA_CELL_ICON_COLUMN = 24;
/**
 * Gap between the icon column and the label text, distinct from
 * `WA_CELL_PADDING` (the card's own leading/trailing inset).
 */
export const WA_CELL_ICON_LABEL_GAP = 16;
/**
 * Leading edge of a cell's LABEL — where S3.4 wants card-internal hairlines to
 * start ("separators inset to the label start, after the icon well"), not the
 * icon column's own start. `WaInsetGroup` defaults `separatorInset` to this.
 */
export const WA_CELL_LABEL_INSET =
  WA_CELL_PADDING + WA_CELL_ICON_COLUMN + WA_CELL_ICON_LABEL_GAP; // 56
/** Chevron glyph size. */
export const WA_CHEVRON_SIZE = 13;
/** Gap between a value label and its trailing chevron. */
export const WA_CHEVRON_GAP = 8;
/** Gap between a section header and the card below it. */
export const WA_SECTION_HEADER_GAP = 8;
/**
 * Section-header type size. S3.5 kills the 12–13pt ALL-CAPS iOS-15 label:
 * WhatsApp's info surfaces carry either no label at all or a sentence-case
 * gray one. `WaSectionLabel` renders `header` at this size, verbatim (no
 * `toUpperCase()`).
 */
export const WA_SECTION_LABEL_SIZE = 15;
/** Section-footer (gray metadata) type size — S3.6's "Created by … Created Jul 27, 2024." */
export const WA_SECTION_FOOTER_SIZE = 13;
/** Vertical spacing between grouped cards (visibly more generous than the header-to-card gap). */
export const WA_GROUP_SPACING = 28;
/** Segmented control height (e.g. "Community" / "Announcements"). */
export const WA_SEGMENTED_HEIGHT = 36;
/** Quick-action circular icon size (Add Members / Add Groups / Search). */
export const WA_QUICK_ACTION_CIRCLE = 38;

// --- S3/§3.3 Action-button cards ---------------------------------------------
//
// The row of white rounded-rect buttons that sits between an info screen's hero
// and its first card group (Open chat / Mute / Invite / Search) — per-screen
// §3.3 and S5.2's "WA uses white button cards", replacing the green circle
// glyphs Togather had.

/** Action-card height. */
export const WA_ACTION_CARD_HEIGHT = 76;
/** Action-card corner radius (softer than the group card, still WA-round). */
export const WA_ACTION_CARD_RADIUS = 18;
/** Gap between adjacent action cards in the row. */
export const WA_ACTION_CARD_GAP = 10;
/** Accent glyph size inside an action card. */
export const WA_ACTION_CARD_ICON_SIZE = 24;
/** Dark label under the glyph. */
export const WA_ACTION_CARD_LABEL_SIZE = 15;

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
/**
 * Island inset from each screen edge. WhatsApp's island is visibly narrower
 * than the screen — 20pt of page shows on either side, where the earlier 10
 * read as an almost-full-bleed bar (calibrated pixel pass, 2026-07-29).
 */
export const WA_TAB_ISLAND_MARGIN_H = 20;
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
/**
 * Scrim painted behind the floating nav zone once a screen's content has
 * scrolled up under it (WA-VISUAL-DELTAS.md S1.1: the circles stay floating,
 * but the strip they sit in stops being see-through so rows don't smear
 * through the status bar). Same near-opaque rgba treatment as the tab island
 * — no `expo-blur`, per ADR-013.
 *
 * Deliberately NOT wired into any kit header component: only the Chats list
 * scrolls its content under a floating nav zone. Events/You render their
 * headers in flow, so a kit-level scrim would paint a permanent band there.
 * `ChatInboxScreen` is the sole consumer.
 */
export const WA_NAV_SCRIM_LIGHT = 'rgba(255,255,255,0.92)';
/** Dark-mode nav scrim. */
export const WA_NAV_SCRIM_DARK = 'rgba(17,27,33,0.92)';

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

/** Breathing room the page-colored band keeps ABOVE the island's top edge. */
export const WA_TAB_ISLAND_BAND_TOP_GAP = 8;

/**
 * How far the island's bottom edge sits above the screen's bottom edge.
 * WhatsApp's island rides LOW — nearly flush with the home indicator (owner's
 * reference, 2026-07-29) — so on home-indicator devices (inset ~34) it sits
 * well inside the safe area rather than stacked on top of it. Inset-less
 * devices keep the plain gap.
 */
export function waTabBarBottomOffset(bottomInset: number): number {
  return Math.max(WA_TAB_ISLAND_BOTTOM_GAP, bottomInset - 20);
}

/**
 * Height of the page-colored BAND the island floats on: from the screen's
 * bottom edge up to `WA_TAB_ISLAND_BAND_TOP_GAP` above the island's TOP edge.
 * 80 at inset 0, 86 at inset 34.
 *
 * A flag-on screen reserves this as padding on the container that carries its
 * page background, so the whole island zone paints as page background instead
 * of live content. The island is absolutely positioned and takes no layout
 * space, so without this the scroll viewport runs to the screen edge and rows
 * render BESIDE the island (in its 20pt side margins) and underneath it — the
 * bottom of the page reads as content soup rather than one surface.
 *
 * Reserving only the strip BELOW the island (what this returned before) is not
 * enough: the island is 64pt tall and inset 20pt from each edge, so rows kept
 * showing to its left and right. The band has to cover the island's full
 * height for the bottom of the page to be a uniform color.
 */
export function waTabBarStripHeight(bottomInset: number): number {
  return (
    waTabBarBottomOffset(bottomInset) + WA_TAB_ISLAND_HEIGHT + WA_TAB_ISLAND_BAND_TOP_GAP
  );
}

/**
 * Bottom padding for a scroll surface whose container already reserves
 * `waTabBarStripHeight`. The band already clears the island, so this is only
 * breathing room between the last row and the band's top edge — not the
 * island's height (which it used to have to cover).
 */
export const WA_TAB_CONTENT_CLEARANCE = 12;

// --- S5.1 Floating screen CTA ------------------------------------------------
//
// The one accent-filled element a top-level screen is allowed (Events'
// "Create Event", Groups' "Add group"). One geometry for all of them, rendered
// by `WaFloatingCta`: a centered auto-width pill, never a full-bleed bar.

/** CTA pill height — fully rounded at this height. */
export const WA_FLOATING_CTA_HEIGHT = 50;
/** Breathing gap the CTA keeps from the island band (and content keeps from the CTA). */
export const WA_FLOATING_CTA_GAP = 12;
/** Leading glyph size inside the pill. */
export const WA_FLOATING_CTA_ICON_SIZE = 22;
/** Gap between the glyph and the label. */
export const WA_FLOATING_CTA_LABEL_GAP = 6;
/** Horizontal padding — the pill hugs its label rather than stretching edge to edge. */
export const WA_FLOATING_CTA_PADDING_H = 22;

/**
 * How far the CTA's BOTTOM edge sits above the SCREEN's bottom edge: it floats
 * a gap above the island BAND, so it never overlaps the island or the band's
 * clean page-colored surface. 92 at inset 0, 98 at inset 34.
 *
 * Measured from the screen bottom on purpose. Yoga positions an absolutely
 * positioned child against its parent's *border* box, ignoring the parent's
 * padding — so a `bottom: 0` CTA inside a container that reserves
 * `waTabBarStripHeight` does NOT start above that band the way CSS would, and
 * the pill lands on top of the island (the owner's 2026-07-29 dark-mode
 * screenshot). Setting `bottom` to this absolute value is padding-independent.
 */
export function waFloatingCtaBottomOffset(bottomInset: number): number {
  return waTabBarStripHeight(bottomInset) + WA_FLOATING_CTA_GAP;
}

/**
 * Bottom padding for a scroll surface that sits under a `WaFloatingCta`, on a
 * container that already reserves `waTabBarStripHeight`: the last row clears
 * the pill floating above the band (the band itself already clears the
 * island). = gap under the pill + the pill + gap above it.
 *
 * Inset-independent — the container's reserved band and the CTA's own offset
 * both move by exactly `waTabBarBottomOffset`, so they cancel.
 */
export const WA_FLOATING_CTA_CONTENT_CLEARANCE =
  WA_TAB_CONTENT_CLEARANCE + WA_FLOATING_CTA_HEIGHT + WA_FLOATING_CTA_GAP; // 74

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
export const WA_BUBBLE_MAX_WIDTH_PCT = 0.75;
/**
 * Bubble corner radius on the three "open" corners. Measured at 12 in the
 * reference, not the spec prose's 18 — the rounder radius was a large part of
 * why our bubbles read "zoomed in" (calibrated pixel pass, 2026-07-29).
 */
export const WA_BUBBLE_RADIUS = 12;
/** Corner radius at the sender-origin corner on the first bubble of a run (the "tail" corner). */
export const WA_BUBBLE_TAIL_CORNER_RADIUS = 4;
/** Bubble internal vertical padding (measured 7, not the prose's 10). */
export const WA_BUBBLE_PADDING_V = 7;
/** Bubble internal horizontal padding. */
export const WA_BUBBLE_PADDING_H = 12;
/** Horizontal margin from the screen edge / avatar to the bubble. */
export const WA_BUBBLE_MARGIN = 8;
/** Vertical gap between consecutive bubbles in the same run (tail dropped). */
export const WA_BUBBLE_GROUPED_GAP = 2;
/** Vertical gap between different senders/runs. */
export const WA_BUBBLE_RUN_GAP = 9;
/**
 * Day pill vertical padding. WhatsApp's capsule is a tight band around its
 * 13pt label — measured 2pt, where 6 gave a chunky lozenge. Width comes from
 * `WaDayPill`'s `minWidth` instead, so short labels ("Today") still read as a
 * capsule rather than a stub.
 */
export const WA_DAY_PILL_PADDING_V = 2;
/** Day pill horizontal padding. */
export const WA_DAY_PILL_PADDING_H = 14;
/** Fraction a reaction chip overlaps its bubble's bottom-outer corner. */
export const WA_REACTION_CHIP_OVERLAP_PCT = 0.4;
/**
 * Reply-quote bar leading accent strip width. 4, not the spec prose's ~3 — at 3
 * the strip read as a hairline rule rather than WhatsApp's clearly-colored bar
 * (owner's direction on the replies round, 2026-07-29).
 */
export const WA_REPLY_QUOTE_BORDER_WIDTH = 4;
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
/**
 * Profile/entity-hero circular avatar size. S3 per-screen §3.2/§4.2 both
 * measure the hero disc at ~100pt (was 108 from the spec prose).
 */
export const WA_AVATAR_PROFILE = 100;
/** Gap between the hero avatar and the 28pt bold name below it. */
export const WA_HERO_NAME_GAP = 12;
/** Gap between the hero name and its 15pt gray subtitle. */
export const WA_HERO_SUBTITLE_GAP = 4;
/** Empty-state illustration/icon size. */
export const WA_EMPTY_STATE_ICON_SIZE = 100;

/**
 * Fallback accent used by `components/wa/*` when a caller doesn't pass an
 * explicit `accent` prop (these components read `useTheme()` for neutral
 * grays but never call `useCommunityTheme()` themselves — see each
 * component's JSDoc). WhatsApp's own default green, per §1.1.
 */
export const WA_DEFAULT_ACCENT = '#25D366';
