import { renderHook, act } from '@testing-library/react-native';
import { Platform } from 'react-native';

// Track what getR2UploadUrl receives
const mockGetR2UploadUrl = jest.fn().mockResolvedValue({
  uploadUrl: 'https://r2.example.com/presigned-url',
  storagePath: 'r2:chat/uuid-test.jpg',
});

jest.mock('@services/api/convex', () => ({
  useAuthenticatedAction: () => mockGetR2UploadUrl,
  api: { functions: { uploads: { getR2UploadUrl: 'getR2UploadUrl' } } },
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

/**
 * Set up fetch mocks for the web upload path:
 *   1st call: blob: URI fetch → returns a Blob with the given MIME
 *   2nd call: PUT to R2 presigned URL → returns ok
 */
function mockWebUpload(blobType: string) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      return Promise.resolve({ ok: true, statusText: 'OK' });
    }
    return Promise.resolve({
      ok: true,
      blob: () => Promise.resolve(new Blob(['fake-image'], { type: blobType })),
    });
  });
}

import { useImageUpload } from '../useImageUpload';

beforeEach(() => {
  jest.clearAllMocks();
  mockFetch.mockReset();
});

describe('useImageUpload', () => {
  describe('filename extension handling', () => {
    test('preserves extension for native file:// URIs', async () => {
      const { result } = renderHook(() => useImageUpload());

      await act(async () => {
        await result.current.uploadImage('file:///photos/vacation.png');
      });

      expect(mockGetR2UploadUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'vacation.png',
          contentType: 'image/png',
        })
      );
    });

    test('does not double-append extension for URIs that already have one', async () => {
      const { result } = renderHook(() => useImageUpload());

      await act(async () => {
        await result.current.uploadImage('file:///photos/image.webp');
      });

      expect(mockGetR2UploadUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'image.webp',
          contentType: 'image/webp',
        })
      );
    });
  });

  describe('web upload flow', () => {
    const originalPlatform = Platform.OS;

    beforeEach(() => {
      (Platform as any).OS = 'web';
    });

    afterEach(() => {
      (Platform as any).OS = originalPlatform;
    });

    test('derives contentType and extension from blob.type for JPEG blob URIs', async () => {
      mockWebUpload('image/jpeg');
      const { result } = renderHook(() => useImageUpload());

      await act(async () => {
        await result.current.uploadImage('blob:http://localhost:8081/f533135f-e039-4303-bf23-fad810cc9e73');
      });

      expect(mockGetR2UploadUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: expect.stringMatching(/\.jpeg$/),
          contentType: 'image/jpeg',
        })
      );
    });

    test('uses image/png and .png for PNG blob URIs (not hardcoded jpeg)', async () => {
      mockWebUpload('image/png');
      const { result } = renderHook(() => useImageUpload());

      await act(async () => {
        await result.current.uploadImage('blob:http://localhost:8081/abc-123');
      });

      expect(mockGetR2UploadUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: expect.stringMatching(/\.png$/),
          contentType: 'image/png',
        })
      );
    });

    test('uses image/webp and .webp for WebP blob URIs', async () => {
      mockWebUpload('image/webp');
      const { result } = renderHook(() => useImageUpload());

      await act(async () => {
        await result.current.uploadImage('blob:http://localhost:8081/webp-asset');
      });

      expect(mockGetR2UploadUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: expect.stringMatching(/\.webp$/),
          contentType: 'image/webp',
        })
      );
    });

    test('PUTs blob to the presigned URL with the blob-derived Content-Type', async () => {
      mockWebUpload('image/png');
      const { result } = renderHook(() => useImageUpload());

      await act(async () => {
        await result.current.uploadImage('blob:http://localhost:8081/abc-123');
      });

      const putCall = mockFetch.mock.calls.find((call) => call[1]?.method === 'PUT');
      expect(putCall).toBeDefined();
      expect(putCall![0]).toBe('https://r2.example.com/presigned-url');
      expect((putCall![1] as RequestInit).headers).toEqual(
        expect.objectContaining({ 'Content-Type': 'image/png' })
      );
    });

    test('falls back to image/jpeg when blob.type is empty', async () => {
      mockWebUpload('');
      const { result } = renderHook(() => useImageUpload());

      await act(async () => {
        await result.current.uploadImage('blob:http://localhost:8081/no-type');
      });

      expect(mockGetR2UploadUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: expect.stringMatching(/\.jpeg$/),
          contentType: 'image/jpeg',
        })
      );
    });
  });

  describe('error handling', () => {
    test('returns error for invalid image URI', async () => {
      const { result } = renderHook(() => useImageUpload());

      let uploadResult: any;
      await act(async () => {
        uploadResult = await result.current.uploadImage('');
      });

      expect(uploadResult.error).toBe('Invalid image URI');
      expect(uploadResult.url).toBe('');
    });
  });
});
