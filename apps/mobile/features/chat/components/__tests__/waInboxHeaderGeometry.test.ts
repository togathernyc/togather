/**
 * Flag-on collapsing-header geometry for the Chats list.
 *
 * These pin the contract that came out of the 2026-07-29 device diagnostic:
 * the flag-on header is an absolute overlay whose reserved height is a PLAIN
 * `paddingTop` on the list, and whose collapse animates opacity + transform
 * ONLY. Animating `height` from a Reanimated worklet is what made the header
 * render pre-collapsed on iOS Fabric (reanimated 4.1.6 races the ShadowTree
 * commit) — invisible on web, because the browser discards the invalid value
 * and the static CSS height wins. Nothing here may regress to a layout prop.
 *
 * Pure functions, no render: the whole point is that this geometry is
 * inspectable without a device.
 */
import {
  WA_NAV_ZONE_HEIGHT,
  WA_HEADER_COLLAPSIBLE,
  WA_RESOURCE_CHIPS_BLOCK_HEIGHT,
  WA_RESOURCE_CHIP_HEIGHT,
  waHeaderExpandedHeight,
  waCollapsibleStyle,
  waNavScrimStyle,
  waListContentPadding,
} from '../waInboxHeaderGeometry';
import { WA_HEADER_CIRCLE_SIZE, WA_TAB_CONTENT_CLEARANCE } from '@components/wa';

/** Style keys that must never appear in a flag-on animated style. */
const LAYOUT_KEYS = [
  'height',
  'width',
  'minHeight',
  'maxHeight',
  'top',
  'bottom',
  'left',
  'right',
  'margin',
  'marginTop',
  'marginBottom',
  'padding',
  'paddingTop',
  'paddingBottom',
  'flex',
  'flexBasis',
];

describe('flag-on header geometry', () => {
  it('reserves the nav zone as button row + 8pt above and below', () => {
    expect(WA_NAV_ZONE_HEIGHT).toBe(8 + WA_HEADER_CIRCLE_SIZE + 8);
    expect(WA_NAV_ZONE_HEIGHT).toBe(60);
  });

  it('collapses the 34pt title line and the search block, 112pt total', () => {
    // Deliberately NOT the flag-off COLLAPSE_DISTANCE (108): that one is a
    // scroll distance built from a nav row the flag-on title does not share.
    expect(WA_HEADER_COLLAPSIBLE).toBe(112);
  });

  it('adds the resource chip strip to the expanded height only when there are chips', () => {
    expect(waHeaderExpandedHeight(59)).toBe(59 + 60 + 112);
    expect(waHeaderExpandedHeight(59, WA_RESOURCE_CHIPS_BLOCK_HEIGHT)).toBe(
      59 + 60 + 112 + 44
    );
    // Desktop sidebar renders in a pane, not under the status bar.
    expect(waHeaderExpandedHeight(0)).toBe(172);
  });

  it('sizes the chip strip as a 34pt pill plus its 10pt gap', () => {
    expect(WA_RESOURCE_CHIP_HEIGHT).toBe(34);
    expect(WA_RESOURCE_CHIPS_BLOCK_HEIGHT - WA_RESOURCE_CHIP_HEIGHT).toBe(10);
  });
});

describe('waCollapsibleStyle', () => {
  it('animates opacity and transform ONLY — never a layout prop', () => {
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      const style = waCollapsibleStyle(p, WA_HEADER_COLLAPSIBLE);
      expect(Object.keys(style).sort()).toEqual(['opacity', 'transform']);
      for (const key of LAYOUT_KEYS) {
        expect(style).not.toHaveProperty(key);
      }
      expect(Object.keys(style.transform[0])).toEqual(['translateY']);
    }
  });

  it('slides the block exactly its own height up over the collapse', () => {
    expect(waCollapsibleStyle(0, 112).transform[0].translateY).toBe(-0);
    expect(waCollapsibleStyle(0.5, 112).transform[0].translateY).toBe(-56);
    expect(waCollapsibleStyle(1, 112).transform[0].translateY).toBe(-112);
    // With chips, the block is taller and must clear its full height.
    expect(waCollapsibleStyle(1, 112 + 44).transform[0].translateY).toBe(-156);
  });

  it('is fully faded before the block reaches the floating buttons', () => {
    expect(waCollapsibleStyle(0, 112).opacity).toBe(1);
    expect(waCollapsibleStyle(0.55, 112).opacity).toBe(0);
    expect(waCollapsibleStyle(1, 112).opacity).toBe(0);
  });

  it('clamps outside 0..1 so overscroll and rubber-banding can not invert it', () => {
    expect(waCollapsibleStyle(-3, 112).transform[0].translateY).toBe(-0);
    expect(waCollapsibleStyle(-3, 112).opacity).toBe(1);
    expect(waCollapsibleStyle(9, 112).transform[0].translateY).toBe(-112);
  });
});

describe('waNavScrimStyle', () => {
  it('animates opacity only — the scrim height is static', () => {
    for (const p of [0, 0.5, 1]) {
      expect(Object.keys(waNavScrimStyle(p))).toEqual(['opacity']);
    }
  });

  it('is invisible at rest and opaque once content scrolls under the buttons', () => {
    expect(waNavScrimStyle(0).opacity).toBe(0);
    expect(waNavScrimStyle(0.5).opacity).toBe(0.5);
    expect(waNavScrimStyle(1).opacity).toBe(1);
    expect(waNavScrimStyle(4).opacity).toBe(1);
    expect(waNavScrimStyle(-4).opacity).toBe(0);
  });
});

describe('waListContentPadding', () => {
  it('adds NOTHING flag-off — that header is in flow and pads itself', () => {
    expect(
      waListContentPadding(false, { insetTop: 59, chipsHeight: 0, windowHeight: 844 })
    ).toBeNull();
  });

  it('reserves the overlay height at the top and the tab island at the bottom', () => {
    const style = waListContentPadding(true, {
      insetTop: 59,
      chipsHeight: 44,
      windowHeight: 844,
    })!;
    expect(style.paddingTop).toBe(waHeaderExpandedHeight(59, 44));
    expect(style.paddingBottom).toBe(WA_TAB_CONTENT_CLEARANCE);
  });

  it('lets a short list scroll far enough to finish the collapse', () => {
    const style = waListContentPadding(true, {
      insetTop: 59,
      chipsHeight: 0,
      windowHeight: 844,
    })!;
    expect(style.minHeight).toBe(844 + WA_HEADER_COLLAPSIBLE);
    expect(style.minHeight - 844).toBeGreaterThanOrEqual(WA_HEADER_COLLAPSIBLE);
  });
});
