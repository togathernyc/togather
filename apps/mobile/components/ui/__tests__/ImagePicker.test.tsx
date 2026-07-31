/**
 * Regression cover for the "attached receipt is invisible" bug: once a photo
 * is picked, `ImagePicker` must actually render it, on web as well as native.
 *
 * The preview goes through `AppImage`, which resolves its `source` with
 * `getMediaUrl`. That helper only ever recognized `http(s)://`, `file://` and
 * `r2:` — so the `blob:` object URL expo-image-picker returns on web resolved
 * to `undefined` and AppImage silently fell back to its gray placeholder.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { ImagePickerComponent } from '../ImagePicker';

jest.mock('@hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      surfaceSecondary: '#f5f5f5',
      buttonSecondary: '#fafafa',
      destructive: '#c00',
      iconSecondary: '#999',
      textInverse: '#fff',
    },
  }),
}));

jest.mock('@hooks/useCommunityTheme', () => ({
  useCommunityTheme: () => ({ primaryColor: '#0a7' }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

const noop = () => {};

describe('ImagePicker preview', () => {
  it.each([
    ['a native file:// URI', 'file:///tmp/receipt.jpg'],
    ['a web blob: URI', 'blob:http://localhost:8081/6b9f-1f2e'],
  ])('renders the picked image for %s', (_label, uri) => {
    render(
      <ImagePickerComponent
        onImageSelected={noop}
        currentImage={uri}
        testID="receipt-preview"
      />,
    );

    const image = screen.getByTestId('receipt-preview');
    expect(image.props.source).toEqual({ uri });
    // The gray placeholder is the bug's signature — it must be gone.
    expect(screen.queryByTestId('receipt-preview-placeholder')).toBeNull();
  });

  it('does not render an inline data: payload', () => {
    // Deliberate bound, not an oversight: expo-image-picker's web path uses
    // `URL.createObjectURL`, so a picked image is always `blob:`. `data:` is
    // the one scheme that embeds an arbitrary payload, and `getMediaUrl` is
    // shared with chat attachments whose URLs are unvalidated strings — so it
    // stays unresolvable, and the placeholder is the correct outcome here.
    render(
      <ImagePickerComponent
        onImageSelected={noop}
        currentImage="data:image/jpeg;base64,/9j/4AAQSkZJRg=="
        testID="receipt-preview"
      />,
    );

    expect(screen.getByTestId('receipt-preview-placeholder')).toBeTruthy();
  });

  it('shows the dropzone (and no preview) before anything is picked', () => {
    render(
      <ImagePickerComponent
        onImageSelected={noop}
        buttonText="Attach receipt photo"
        testID="receipt-preview"
      />,
    );

    expect(screen.getByText('Attach receipt photo')).toBeTruthy();
    expect(screen.queryByTestId('receipt-preview')).toBeNull();
  });
});
