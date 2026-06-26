import { isValidImageUri, getPastedImageFiles } from '../imageUpload';

describe('getPastedImageFiles', () => {
  const file = (type: string) => ({ type }) as File;
  const item = (type: string, asFile: File | null) =>
    ({ kind: 'file', type, getAsFile: () => asFile }) as unknown as DataTransferItem;

  test('returns image files from clipboard items (preferred path)', () => {
    const png = file('image/png');
    const clipboard = {
      items: [item('image/png', png)],
      files: [],
    } as unknown as DataTransfer;
    expect(getPastedImageFiles(clipboard)).toEqual([png]);
  });

  test('falls back to clipboard.files when items has no images', () => {
    const jpg = file('image/jpeg');
    const clipboard = {
      items: [],
      files: [jpg],
    } as unknown as DataTransfer;
    expect(getPastedImageFiles(clipboard)).toEqual([jpg]);
  });

  test('ignores non-image items (e.g. text-only paste)', () => {
    const clipboard = {
      items: [item('text/plain', null)],
      files: [],
    } as unknown as DataTransfer;
    expect(getPastedImageFiles(clipboard)).toEqual([]);
  });

  test('ignores non-image files', () => {
    const clipboard = {
      items: [],
      files: [file('application/pdf')],
    } as unknown as DataTransfer;
    expect(getPastedImageFiles(clipboard)).toEqual([]);
  });

  test('returns [] when clipboard is missing', () => {
    expect(getPastedImageFiles(null)).toEqual([]);
    expect(getPastedImageFiles(undefined)).toEqual([]);
  });

  test('drops items whose getAsFile() yields null', () => {
    const clipboard = {
      items: [item('image/png', null)],
      files: [],
    } as unknown as DataTransfer;
    expect(getPastedImageFiles(clipboard)).toEqual([]);
  });
});

describe('isValidImageUri', () => {
  // Native URI schemes
  test('accepts file:// URIs', () => {
    expect(isValidImageUri('file:///path/to/image.jpg')).toBe(true);
  });

  test('accepts data:image/ URIs', () => {
    expect(isValidImageUri('data:image/png;base64,abc123')).toBe(true);
  });

  test('accepts content:// URIs (Android)', () => {
    expect(isValidImageUri('content://media/external/images/123')).toBe(true);
  });

  test('accepts assets-library:// URIs (iOS legacy)', () => {
    expect(isValidImageUri('assets-library://asset/photo.jpg')).toBe(true);
  });

  test('accepts ph:// URIs (iOS Photos)', () => {
    expect(isValidImageUri('ph://CC95F08C-88C3-4012-9D6D-64A413D254B3')).toBe(true);
  });

  // Web URI schemes
  test('accepts blob: URIs (web image picker)', () => {
    expect(isValidImageUri('blob:http://localhost:8081/f533135f-e039-4303-bf23-fad810cc9e73')).toBe(true);
  });

  test('accepts http:// URIs', () => {
    expect(isValidImageUri('http://localhost:8081/image.png')).toBe(true);
  });

  test('accepts https:// URIs', () => {
    expect(isValidImageUri('https://example.com/photo.jpg')).toBe(true);
  });

  // Invalid inputs
  test('rejects empty string', () => {
    expect(isValidImageUri('')).toBe(false);
  });

  test('rejects plain text', () => {
    expect(isValidImageUri('not-a-uri')).toBe(false);
  });

  test('rejects ftp:// URIs', () => {
    expect(isValidImageUri('ftp://server/image.jpg')).toBe(false);
  });
});
