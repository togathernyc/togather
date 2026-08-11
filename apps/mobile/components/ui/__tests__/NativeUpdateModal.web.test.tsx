/**
 * Tests for the web variant of NativeUpdateModal.
 *
 * The native modal force-blocks the whole app when the R2 release manifest
 * reports a newer build than the one the user is running. On web there is no
 * installable build to update to — togather.nyc always serves the latest
 * deployed export — so the gate must be completely inert there. It previously
 * was not, and a manifest bump to 1.0.22 locked every web visitor out of
 * /signin behind an undismissable "Open App Store" dialog.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { NativeUpdateModal } from '../NativeUpdateModal.web';

describe('NativeUpdateModal (web)', () => {
  it('renders nothing', () => {
    const { toJSON } = render(<NativeUpdateModal />);
    expect(toJSON()).toBeNull();
  });

  it('never fetches the release manifest', () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    render(<NativeUpdateModal />);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
