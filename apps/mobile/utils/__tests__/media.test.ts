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

  test('returns web picker blob: URIs as-is', () => {
    // Regression: on web, expo-image-picker hands back a `blob:` object URL,
    // not `file://`. Dropping it made every just-picked image preview
    // (reimbursement receipts, profile/group photos) fall through to
    // AppImage's gray placeholder instead of showing the picked photo.
    const blobUri = 'blob:http://localhost:8081/6b9f-1f2e';
    expect(getMediaUrl(blobUri)).toBe(blobUri);
  });

  test('refuses inline data: payloads', () => {
    // `blob:`/`file://` are references that only resolve locally, so a
    // server-supplied one is inert. `data:` carries its payload inline, and
    // `chatMessages.attachments[].url` is an unvalidated string — trusting it
    // here would let any group member render an unbounded, uncacheable,
    // untransformable blob in everyone else's chat. The picker never emits
    // one, so refusing costs nothing.
    expect(getMediaUrl('data:image/jpeg;base64,/9j/4AAQSkZJRg==')).toBeUndefined();
  });

  test('expands r2: paths to the CDN URL', () => {
    expect(getMediaUrl('r2:chat/a.jpg')).toBe(`${CDN}/chat/a.jpg`);
  });

  test('returns undefined for unrecognized paths', () => {
    expect(getMediaUrl('s3:bucket/a.jpg')).toBeUndefined();
  });
});

describe('getMediaUrlWithTransform', () => {
  test('preserves EXIF metadata so orientation survives the transform', () => {
    // Regression: without metadata=keep, Cloudflare strips the orientation tag
    // without rotating the pixels, so rotated photos render upside-down inline.
    const url = getMediaUrlWithTransform('r2:chat/a.jpg', { width: 400 });
    expect(url).toContain('metadata=keep');
  });

  test('builds a same-zone cdn-cgi transform URL with the expected options', () => {
    const url = getMediaUrlWithTransform('r2:chat/a.jpg', {
      width: 400,
      height: 300,
      fit: 'cover',
      quality: 85,
    });
    expect(url).toBe(
      `${CDN}/cdn-cgi/image/width=400,height=300,fit=cover,quality=85,metadata=keep,format=auto/chat/a.jpg`
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

  test('leaves local preview URIs untransformed', () => {
    // Callers pass optimizedWidth for the eventual CDN copy; a not-yet-uploaded
    // local pick has nothing to transform and must survive verbatim.
    for (const local of ['file:///tmp/a.jpg', 'blob:http://localhost:8081/6b9f-1f2e']) {
      expect(getMediaUrlWithTransform(local, { width: 600 })).toBe(local);
    }
  });
});
