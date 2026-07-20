/**
 * Tests for the web-only ImageViewer zoom math.
 *
 * The full web viewer is a plain-DOM component (wheel/pointer/drag), which the
 * react-native jest harness can't drive end-to-end; the interactive behavior is
 * verified on staging (see the PR). These tests cover the pure zoom-bounds logic
 * — the spec's "clamp to a sensible range (about 1x-5x)" edge case — so a
 * regression there is caught in CI.
 */
import { clampScale, clampPan } from '../ImageViewer.web';

describe('ImageViewer.web zoom math', () => {
  describe('clampScale', () => {
    it('never zooms out past fit (1x)', () => {
      expect(clampScale(0.2)).toBe(1);
      expect(clampScale(1)).toBe(1);
    });

    it('never zooms in past the max (5x)', () => {
      expect(clampScale(9)).toBe(5);
      expect(clampScale(5)).toBe(5);
    });

    it('passes through values inside the range', () => {
      expect(clampScale(2.5)).toBe(2.5);
    });
  });

  describe('clampPan', () => {
    it('does not allow panning while at fit (1x)', () => {
      // At scale 1 the allowed travel is 0 in both axes.
      const { tx, ty } = clampPan(200, -50, 1, 800, 600);
      expect(tx).toBe(0);
      expect(ty).toBe(0); // -0 === 0, so toBe passes where toEqual distinguishes
    });

    it('allows panning up to half the extra size when zoomed', () => {
      // At 2x on an 800x600 area, max travel is (2-1)*size/2 = 400 / 300.
      expect(clampPan(1000, 1000, 2, 800, 600)).toEqual({ tx: 400, ty: 300 });
      expect(clampPan(-1000, -1000, 2, 800, 600)).toEqual({ tx: -400, ty: -300 });
    });

    it('leaves an in-bounds pan untouched', () => {
      expect(clampPan(50, -20, 2, 800, 600)).toEqual({ tx: 50, ty: -20 });
    });
  });
});
