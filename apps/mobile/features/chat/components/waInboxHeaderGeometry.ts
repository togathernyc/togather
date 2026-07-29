/**
 * Flag-on collapsing-header geometry for the Chats list (`ChatInboxScreen`).
 *
 * Split out of the screen so it can be unit-tested without importing the whole
 * component (which drags in expo-router, Convex and the auth provider). Every
 * value and every animated style the flag-on header uses lives here.
 */
import {
  WA_HEADER_CIRCLE_SIZE,
  WA_TAB_CONTENT_CLEARANCE,
} from "@components/wa";

/** 34pt heavy title on its own line below the floating-button row (S1.2). */
export const WA_LARGE_TITLE_BLOCK_HEIGHT = 48;
/** Search-pill block: the 12pt gap, the 44pt pill, and the header's 8pt tail. */
export const WA_SEARCH_BLOCK_HEIGHT = 64;

// --- Flag-on collapsing-header geometry -------------------------------------
//
// # Why the flag-on header is an OVERLAY and animates nothing but opacity and
// # translateY
//
// The first cut reserved the large title and the search pill by animating
// their `height` from a Reanimated worklet (`searchStyle`, and a
// `waLargeTitleBlockStyle` that no longer exists). On web that is harmless —
// the browser discards the invalid animated value and the static CSS height
// wins — but on iOS Fabric (reanimated 4.1.6) animated LAYOUT props race the
// ShadowTree commit. On a real device the header rendered ALREADY COLLAPSED at
// rest, so the first rows sat under the floating buttons, and expanding it
// painted straight through the row content (owner's recording, 2026-07-29).
//
// Reanimated 4.1.6 is a known-broken release for this and must NOT be bumped
// (CLAUDE.md native-dependency discipline). So flag-on:
//
//   - the header is `position: absolute` over the list and takes no layout
//     space at all — nothing about it can race a layout commit;
//   - the space it occupies is reserved by a PLAIN React `paddingTop` on the
//     list's content container, which is committed synchronously with the rest
//     of the tree;
//   - the collapse is a pure `opacity` + `translateY` transform of the block
//     holding the title, the search pill and the resource chips, sliding them
//     up under the floating-button row. No animated style flag-on carries a
//     layout key. `waCollapsibleStyle`/`waNavScrimStyle` below are pure
//     functions precisely so that contract is unit-testable.
//
// The flag-off header keeps its height animation verbatim.

/** Floating-button row plus its 8pt breathing room above and below. */
export const WA_NAV_ZONE_HEIGHT = 8 + WA_HEADER_CIRCLE_SIZE + 8; // 60
/**
 * Everything below the nav zone that scrolls away: the 34pt title line and the
 * search-pill block.
 *
 * Note this is 112, not the flag-off `COLLAPSE_DISTANCE` of 108 — that value
 * is `NAV_ROW_HEIGHT + SEARCH_BLOCK_HEIGHT`, which is only coincidentally
 * close, since the flag-off large title is overlaid on the nav row rather than
 * having a line of its own. `COLLAPSE_DISTANCE` still drives the collapse
 * *progress* in both shells (it's a scroll distance, not a height); this is
 * the flag-on *reserved height*.
 */
export const WA_HEADER_COLLAPSIBLE = WA_LARGE_TITLE_BLOCK_HEIGHT + WA_SEARCH_BLOCK_HEIGHT; // 112
/** Resource chip row: a 34pt pill plus the 10pt gap above it (B3). */
export const WA_RESOURCE_CHIPS_BLOCK_HEIGHT = 44;
/** Resource chip height — WhatsApp's filter chips measure 32-34pt. */
export const WA_RESOURCE_CHIP_HEIGHT = 34;

/**
 * Total height the flag-on header overlays, i.e. exactly the `paddingTop` the
 * list content needs so its first row starts below the fully expanded header.
 *
 * `insetTop` is the top safe-area inset, or 0 in desktop `sidebarMode` (which
 * renders inside a pane, not under the status bar). `chipsHeight` is
 * `WA_RESOURCE_CHIPS_BLOCK_HEIGHT` when the community has inbox resources.
 */
export function waHeaderExpandedHeight(insetTop: number, chipsHeight = 0): number {
  return insetTop + WA_NAV_ZONE_HEIGHT + WA_HEADER_COLLAPSIBLE + chipsHeight;
}

/**
 * Animated style for the flag-on collapsible block. MUST contain only
 * `opacity` and `transform` — see the geometry note above.
 *
 * The block fades out over the first 55% of the collapse so it's invisible by
 * the time it has slid far enough to overlap the floating buttons, and by the
 * time the nav scrim behind it is opaque enough to matter.
 */
export function waCollapsibleStyle(progress: number, collapsible: number) {
  "worklet";
  const p = Math.min(Math.max(progress, 0), 1);
  return {
    opacity: Math.min(Math.max(1 - p / 0.55, 0), 1),
    transform: [{ translateY: -p * collapsible }],
  };
}

/**
 * Animated style for the nav-zone scrim (A3): transparent at rest so the
 * buttons read as floating over the list, opaque once rows are passing
 * underneath. Opacity only — the scrim's height is static.
 */
export function waNavScrimStyle(progress: number) {
  "worklet";
  return { opacity: Math.min(Math.max(progress, 0), 1) };
}

/**
 * Extra `contentContainerStyle` for the inbox list. `null` when the flag is
 * off — the flag-off header is in flow, so adding a `paddingTop` there would
 * double-space it.
 *
 * `minHeight` lets a short list still scroll far enough to complete the
 * collapse, so the header can't get stuck half-expanded on a small inbox.
 */
export function waListContentPadding(
  enabled: boolean,
  { insetTop, chipsHeight, windowHeight }: { insetTop: number; chipsHeight: number; windowHeight: number }
): { paddingTop: number; paddingBottom: number; minHeight: number } | null {
  if (!enabled) return null;
  return {
    paddingTop: waHeaderExpandedHeight(insetTop, chipsHeight),
    paddingBottom: WA_TAB_CONTENT_CLEARANCE,
    minHeight: windowHeight + WA_HEADER_COLLAPSIBLE,
  };
}

