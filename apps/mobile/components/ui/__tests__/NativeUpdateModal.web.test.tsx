/**
 * Tests for the web variant of NativeUpdateModal.
 *
 * The native modal force-blocks the whole app when the R2 release manifest
 * reports a newer build than the one the user is running. On web there is no
 * installable build to update to — togather.nyc always serves the latest
 * deployed export — so the gate must be completely inert there. It previously
 * was not, and a manifest bump to 1.0.22 locked every web visitor out of
 * /signin behind an undismissable "Open App Store" dialog.
 *
 * These tests deliberately run the NATIVE component first, as a control. Under
 * jest-expo `__DEV__` is true, so the native component short-circuits at
 * NativeUpdateModal.tsx:114 and renders null too — meaning a naive "web variant
 * renders null" assertion passes against BOTH components and guards nothing.
 * Forcing `__DEV__ = false` and serving a newer manifest makes the native
 * component actually block, so the web assertions below can only pass because
 * the web variant is inert — not because the harness never armed the gate.
 */
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { NativeUpdateModal as NativeVariant } from '../NativeUpdateModal';
import { NativeUpdateModal as WebVariant } from '../NativeUpdateModal.web';

const NEWER_MANIFEST = {
  version: '1.0.22',
  platform: 'ios',
  environment: 'production',
  releaseDate: '2026-03-20T01:05:46Z',
  downloadUrl: 'https://apps.apple.com/us/app/togather-life-in-community/id6756286011',
  minSupportedVersion: '1.0.0',
};

/** Reproduces production: not dev, and a manifest newer than the running build. */
function armTheGate() {
  (global as any).__DEV__ = false;
  return jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => NEWER_MANIFEST,
  } as Response);
}

describe('NativeUpdateModal', () => {
  const realDev = (global as any).__DEV__;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = armTheGate();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    (global as any).__DEV__ = realDev;
  });

  // Control: proves the harness can actually trigger the block. If this test
  // stops failing-open, the web assertions below become meaningless again.
  describe('native variant (control)', () => {
    it('fetches the manifest and blocks when a newer version exists', async () => {
      const { findByText } = render(<NativeVariant />);

      expect(await findByText('Update Required')).toBeTruthy();
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('releases/ios/production/manifest.json')
      );
    });
  });

  describe('web variant', () => {
    it('stays inert under the exact conditions that block on native', async () => {
      const { queryByText, toJSON } = render(<WebVariant />);

      // Flush the effects and the resolved fetch. Asserting null immediately
      // would pass even against the native gate, which also renders null on its
      // first pass while `isChecking` is true — the block only appears once the
      // manifest promise settles.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(queryByText('Update Required')).toBeNull();
      expect(toJSON()).toBeNull();
    });
  });
});
