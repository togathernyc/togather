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

// Mock fetch for web upload path
const mockFetch = jest.fn().mockResolvedValue({
  ok: true,
  blob: () => Promise.resolve(new Blob(['fake-image'], { type: 'image/jpeg' })),
});
global.fetch = mockFetch;

import { useImageUpload } from '../useImageUpload';

beforeEach(() => {
  jest.clearAllMocks();
  mockFetch.mockResolvedValue({
    ok: true,
    blob: () => Promise.resolve(new Blob(['fake-image'], { type: 'image/jpeg' })),
  });
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

    test('appends .jpg extension for blob URIs without extension (web)', async () => {
      const { result } = renderHook(() => useImageUpload());

      await act(async () => {
        await result.current.uploadImage('blob:http://localhost:8081/f533135f-e039-4303-bf23-fad810cc9e73');
      });

      // The blob URI segment has no extension, so .jpg should be appended
      expect(mockGetR2UploadUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: expect.stringMatching(/\.jpg$/),
          contentType: 'image/jpeg',
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

    test('uses fetch with PUT for web uploads', async () => {
      const { result } = renderHook(() => useImageUpload());

      await act(async () => {
        await result.current.uploadImage('blob:http://localhost:8081/abc-123');
      });

      // First fetch: blob URI to get blob data
      // Second fetch: PUT to R2 presigned URL
      const putCall = mockFetch.mock.calls.find(
        (call) => call[1]?.method === 'PUT'
      );
      expect(putCall).toBeDefined();
      expect(putCall![0]).toBe('https://r2.example.com/presigned-url');
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
