import { getMediaUrl, getMediaUrlWithTransform } from '../media';

const CDN = 'https://images.togather.nyc';

describe('getMediaUrl', () => {
  test('returns undefined for empty input', () => {
    expect(getMediaUrl(undefined)).toBeUndefined();
    expect(getMediaUrl(null)).toBeUndefined();
    expect(getMediaUrl('')).toBeUndefined();
  });

  test('returns http(s) URLs as-is', () => {
    expect(getMediaUrl('https://example.com/a.jpg')).toBe('https://example.com/a.jpg');
    expect(getMediaUrl('http://example.com/a.jpg')).toBe('http://example.com/a.jpg');
  });

  test('returns local file URIs as-is', () => {
    expect(getMediaUrl('file:///tmp/a.jpg')).toBe('file:///tmp/a.jpg');
  });

  test('expands r2: paths to the CDN URL', () => {
    expect(getMediaUrl('r2:chat/a.jpg')).toBe(`${CDN}/chat/a.jpg`);
  });

  test('returns undefined for unrecognized paths', () => {
    expect(getMediaUrl('s3:bucket/a.jpg')).toBeUndefined();
  });
});

describe('getMediaUrlWithTransform', () => {
  test('builds a same-zone cdn-cgi transform URL with the expected options', () => {
    const url = getMediaUrlWithTransform('r2:chat/a.jpg', {
      width: 400,
      height: 300,
      fit: 'cover',
      quality: 85,
    });
    expect(url).toBe(
      `${CDN}/cdn-cgi/image/width=400,height=300,fit=cover,quality=85,format=auto/chat/a.jpg`
    );
  });

  test('always requests automatic format optimization', () => {
    const url = getMediaUrlWithTransform('r2:chat/a.jpg', { width: 400 });
    expect(url).toContain('format=auto');
  });

  test('does not apply transforms to non-R2 (legacy) images', () => {
    const legacy = 'https://example.com/a.jpg';
    expect(getMediaUrlWithTransform(legacy, { width: 400 })).toBe(legacy);
  });

  test('returns undefined when the path cannot be resolved', () => {
    expect(getMediaUrlWithTransform(undefined, { width: 400 })).toBeUndefined();
  });
});
