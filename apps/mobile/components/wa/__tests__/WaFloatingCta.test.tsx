/**
 * WaFloatingCta — geometry + clearance contract (WA-VISUAL-DELTAS.md S5.1).
 *
 * The clearance assertions are the point of this file: the owner's dark-mode
 * screenshot showed the pill sitting ON the tab island, so the maths that keeps
 * it above the island is pinned here rather than left to eyeballing.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { WaFloatingCta } from '../WaFloatingCta';
import {
  WA_FLOATING_CTA_HEIGHT,
  WA_FLOATING_CTA_GAP,
  WA_FLOATING_CTA_CONTENT_CLEARANCE,
  WA_TAB_ISLAND_HEIGHT,
  WA_TYPE_ROW_TITLE,
  WA_WEIGHT_SEMIBOLD,
  waFloatingCtaBottomOffset,
  waTabBarBottomOffset,
  waTabBarStripHeight,
} from '../metrics';

const flatten = (style: unknown) => StyleSheet.flatten(style as never) as Record<string, unknown>;

describe('WaFloatingCta', () => {
  it('renders its label and leading glyph', () => {
    const { getByText } = render(
      <WaFloatingCta label="Add group" icon="add" onPress={() => {}} bottomInset={34} />
    );
    expect(getByText('Add group')).toBeTruthy();
    expect(getByText('add')).toBeTruthy();
  });

  it('fires onPress', () => {
    const onPress = jest.fn();
    const { getByLabelText } = render(
      <WaFloatingCta label="Create event" icon="add" onPress={onPress} bottomInset={0} />
    );
    fireEvent.press(getByLabelText('Create event'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is a centered auto-width pill — never a full-bleed bar', () => {
    const { getByTestId } = render(
      <WaFloatingCta
        label="Add group"
        icon="add"
        onPress={() => {}}
        bottomInset={34}
        testID="cta"
      />
    );
    const pill = flatten(getByTestId('cta').props.style);
    expect(pill.height).toBe(WA_FLOATING_CTA_HEIGHT);
    expect(pill.borderRadius).toBe(WA_FLOATING_CTA_HEIGHT / 2);
    // Auto width: horizontal padding hugs the label, and the pill never
    // stretches (no alignSelf: 'stretch', no width/flex).
    expect(pill.paddingHorizontal).toBeGreaterThan(0);
    expect(pill.width).toBeUndefined();
    expect(pill.flex).toBeUndefined();
    expect(pill.alignSelf).toBeUndefined();
  });

  it('paints the accent as fill with a white 17pt semibold label (the single accent element)', () => {
    const { getByTestId, getByText } = render(
      <WaFloatingCta
        label="Add group"
        icon="add"
        onPress={() => {}}
        accent="#7B1FA2"
        bottomInset={34}
        testID="cta"
      />
    );
    expect(flatten(getByTestId('cta').props.style).backgroundColor).toBe('#7B1FA2');
    const label = flatten(getByText('Add group').props.style);
    expect(label.color).toBe('#FFFFFF');
    expect(label.fontSize).toBe(WA_TYPE_ROW_TITLE);
    expect(label.fontWeight).toBe(WA_WEIGHT_SEMIBOLD);
  });

  it.each([0, 20, 34, 59])(
    'floats clear of the tab island at bottom inset %p',
    (inset) => {
      const { getByTestId } = render(
        <WaFloatingCta
          label="Add group"
          onPress={() => {}}
          bottomInset={inset}
          testID="cta"
        />
      );
      // The wrapper's `bottom` is measured from the screen edge (Yoga ignores
      // parent padding for absolute children).
      const wrap = flatten(getByTestId('cta-wrap').props.style);
      const islandTop = waTabBarBottomOffset(inset) + WA_TAB_ISLAND_HEIGHT;
      expect(wrap.bottom).toBe(islandTop + WA_FLOATING_CTA_GAP);
      expect(wrap.bottom as number).toBeGreaterThan(islandTop);
      expect(wrap.position).toBe('absolute');
    }
  );
});

describe('WA_FLOATING_CTA_CONTENT_CLEARANCE', () => {
  it.each([0, 20, 34, 59])(
    'lets the last scroll row clear both the island and the pill at inset %p',
    (inset) => {
      // A flag-on screen reserves `waTabBarStripHeight` on the container that
      // paints the page background, so scroll content ends that far above the
      // screen edge. Its bottom padding then has to reach past the pill's top.
      const contentBottomEdge = waTabBarStripHeight(inset);
      const lastRowBottom = contentBottomEdge + WA_FLOATING_CTA_CONTENT_CLEARANCE;
      const ctaTop = waFloatingCtaBottomOffset(inset) + WA_FLOATING_CTA_HEIGHT;
      expect(lastRowBottom).toBe(ctaTop + WA_FLOATING_CTA_GAP);
      expect(lastRowBottom).toBeGreaterThan(ctaTop);
    }
  );
});
