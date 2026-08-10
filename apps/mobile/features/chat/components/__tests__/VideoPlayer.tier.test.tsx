/**
 * VideoPlayer tier-selection tests.
 *
 * WHAT THIS COVERS
 * ----------------
 * `VideoPlayer` chooses a render "tier" based on which native modules are
 * available (see the priority chain in VideoPlayer.tsx):
 *   1. web            -> HTML5 <video>          (WebVideoPlayer)
 *   2. expo-video     -> ExpoVideoPlayer        (preferred native player)
 *   3. expo-av        -> VideoPlayerInner       (legacy native fallback)
 *   4. none available -> VideoDownloadFallback  ("Tap to download")
 *
 * These tests assert the SELECTION logic: for a supported-video case the
 * component must mount a real player tier and must NOT silently fall through to
 * the download fallback (a blank/degraded experience).
 *
 * WHAT THIS CANNOT COVER (documented limitation)
 * ----------------------------------------------
 * This is a jest test: `expo-video` / `expo-av` and their Fabric native VIEWS
 * are MOCKED here (see jest.mock calls below). So this test proves the JS tier
 * selection is correct, but it CANNOT catch the failure class that motivated
 * this suite — the #548 regression where a second React entered the module
 * graph and broke native Fabric view/module registration, so the very same
 * ExpoVideoPlayer/VideoView tier selected here rendered BLANK on the installed
 * binary while every jest test still passed. Catching that requires driving the
 * real app on a device/simulator; see
 * docs/architecture/ADR-030-native-media-smoke-test.md.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

// --- Mocks -----------------------------------------------------------------

// Control the tier-selection inputs directly. VideoPlayer imports these two
// detection helpers from ../utils/fileTypes.
jest.mock('../../utils/fileTypes', () => ({
  isVideoSupported: jest.fn(),
  isAudioVideoSupported: jest.fn(),
}));

// getMediaUrl just resolves storage paths -> URLs; keep it deterministic.
jest.mock('@/utils/media', () => ({
  getMediaUrl: jest.fn((url: string) => url),
}));

// Mock the preferred native player module (expo-video). In a real broken
// native graph THIS is where blank rendering would occur — but jest can't
// observe that (see the file header).
jest.mock(
  'expo-video',
  () => ({
    useVideoPlayer: jest.fn((_uri: string, setup?: (p: any) => void) => {
      const player = {
        loop: false,
        addListener: jest.fn(() => ({ remove: jest.fn() })),
      };
      if (setup) setup(player);
      return player;
    }),
    VideoView: (props: any) => {
      const R = require('react');
      return R.createElement('View', { testID: 'expo-video-view', ...props });
    },
  }),
  { virtual: true }
);

// Mock the legacy native player module (expo-av).
jest.mock(
  'expo-av',
  () => {
    const R = require('react');
    return {
      Video: (props: any) =>
        R.createElement('View', { testID: 'expo-av-video', ...props }),
      ResizeMode: { COVER: 'cover', CONTAIN: 'contain' },
    };
  },
  { virtual: true }
);

import { VideoPlayer } from '../VideoPlayer';
import { isVideoSupported, isAudioVideoSupported } from '../../utils/fileTypes';

const mockIsVideoSupported = isVideoSupported as jest.Mock;
const mockIsAudioVideoSupported = isAudioVideoSupported as jest.Mock;

const SUPPORTED_VIDEO_URL = 'chat-uploads/clip.mp4';

describe('VideoPlayer tier selection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('picks the expo-video tier (not the download fallback) when expo-video is available', () => {
    mockIsVideoSupported.mockReturnValue(true);
    mockIsAudioVideoSupported.mockReturnValue(false);

    const { queryByTestId, queryByText } = render(
      <VideoPlayer url={SUPPORTED_VIDEO_URL} name="clip.mp4" />
    );

    // A real, non-blank player tier is mounted...
    expect(queryByTestId('expo-video-view')).not.toBeNull();
    // ...and we did NOT degrade to the download-only fallback.
    expect(queryByText('Tap to download')).toBeNull();
  });

  it('falls back to the expo-av tier (still not the download fallback) when only expo-av is available', () => {
    mockIsVideoSupported.mockReturnValue(false);
    mockIsAudioVideoSupported.mockReturnValue(true);

    const { queryByTestId, queryByText } = render(
      <VideoPlayer url={SUPPORTED_VIDEO_URL} name="clip.mp4" />
    );

    expect(queryByTestId('expo-av-video')).not.toBeNull();
    expect(queryByText('Tap to download')).toBeNull();
  });

  it('never returns null/blank for a supported video — it always renders a tier', () => {
    // Even in the worst native case (no video module at all), VideoPlayer must
    // render a usable download affordance, never null/blank.
    mockIsVideoSupported.mockReturnValue(false);
    mockIsAudioVideoSupported.mockReturnValue(false);

    const { toJSON, queryByText } = render(
      <VideoPlayer url={SUPPORTED_VIDEO_URL} name="clip.mp4" />
    );

    expect(toJSON()).not.toBeNull();
    // The download fallback is the intended terminal tier here.
    expect(queryByText('Tap to download')).not.toBeNull();
  });
});
