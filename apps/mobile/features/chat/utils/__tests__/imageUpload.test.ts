import { isValidImageUri } from '../imageUpload';

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
