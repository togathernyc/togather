/**
 * §5 reply-quote bar anatomy.
 *
 * The pieces a snapshot would not catch but which are what make the block read
 * as WhatsApp: the accent strip taking the QUOTED sender's hue (not the
 * viewer's, not the brand accent), the single-line ellipsized snippet, the
 * media and deleted-parent fallbacks, and the tap that jumps to the parent.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('@components/ui', () => {
  const { View } = require('react-native');
  return { AppImage: (props: any) => <View testID="app-image" {...props} /> };
});

import { ReplyQuoteBlock, resolveQuoteSnippet } from '../ReplyQuoteBlock';
import { waSenderColor } from '../../waChatChrome';
import { WA_REPLY_QUOTE_BORDER_WIDTH } from '@components/wa/metrics';

const baseQuote = {
  parentMessageId: 'parent-1' as any,
  parentSenderId: 'user-2' as any,
  parentSenderName: 'Dara Peters',
  parentContent: 'Who is bringing the chairs?',
};

describe('ReplyQuoteBlock anatomy', () => {
  test('the accent strip is the QUOTED sender hue, at the spec width', () => {
    const { getByTestId } = render(
      <ReplyQuoteBlock quote={baseQuote} isOwnBubble={false} />,
    );
    const bar = StyleSheet.flatten(getByTestId('wa-reply-quote-bar').props.style);
    expect(bar.width).toBe(WA_REPLY_QUOTE_BORDER_WIDTH);
    expect(bar.backgroundColor).toBe(waSenderColor('user-2', false));
  });

  test('the parent name is 13pt semibold in that same hue', () => {
    const { getByTestId } = render(
      <ReplyQuoteBlock quote={baseQuote} isOwnBubble={false} />,
    );
    const name = getByTestId('wa-reply-quote-name');
    const style = StyleSheet.flatten(name.props.style);
    expect(name.props.children).toBe('Dara Peters');
    expect(style.fontSize).toBe(13);
    expect(style.fontWeight).toBe('600');
    expect(style.color).toBe(waSenderColor('user-2', false));
  });

  test('a different sender gets a different hue', () => {
    const { getByTestId, rerender } = render(
      <ReplyQuoteBlock quote={baseQuote} isOwnBubble={false} />,
    );
    const first = StyleSheet.flatten(
      getByTestId('wa-reply-quote-bar').props.style,
    ).backgroundColor;
    rerender(
      <ReplyQuoteBlock
        quote={{ ...baseQuote, parentSenderId: 'user-2ba' as any }}
        isOwnBubble={false}
      />,
    );
    const second = StyleSheet.flatten(
      getByTestId('wa-reply-quote-bar').props.style,
    ).backgroundColor;
    expect(second).not.toBe(first);
  });

  test('the snippet is a single ellipsized line', () => {
    const { getByTestId } = render(
      <ReplyQuoteBlock quote={baseQuote} isOwnBubble={false} />,
    );
    const snippet = getByTestId('wa-reply-quote-snippet');
    expect(snippet.props.numberOfLines).toBe(1);
    expect(snippet.props.ellipsizeMode).toBe('tail');
    expect(StyleSheet.flatten(snippet.props.style).fontSize).toBe(13);
  });

  test('a multi-line parent is flattened so it stays one line', () => {
    expect(
      resolveQuoteSnippet({
        ...baseQuote,
        parentContent: 'first line\n\nsecond line',
      }).text,
    ).toBe('first line second line');
  });

  test('tapping the block jumps to the quoted message', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <ReplyQuoteBlock quote={baseQuote} isOwnBubble={false} onPress={onPress} />,
    );
    fireEvent.press(getByTestId('wa-reply-quote-parent-1'));
    expect(onPress).toHaveBeenCalledWith('parent-1');
  });
});

describe('ReplyQuoteBlock fallbacks', () => {
  test('a deleted parent quotes WhatsApp’s own copy', () => {
    const { getByTestId } = render(
      <ReplyQuoteBlock
        quote={{ ...baseQuote, parentDeleted: true, parentContent: '' }}
        isOwnBubble={false}
      />,
    );
    const snippet = getByTestId('wa-reply-quote-snippet');
    expect(snippet.props.children).toBe('Original message was deleted');
    expect(StyleSheet.flatten(snippet.props.style).fontStyle).toBe('italic');
    // The author is still named — it's still their message that went away.
    expect(getByTestId('wa-reply-quote-name').props.children).toBe('Dara Peters');
  });

  test('a deleted parent with no known author gets a neutral strip', () => {
    const { getByTestId } = render(
      <ReplyQuoteBlock
        quote={{
          parentMessageId: 'parent-1' as any,
          parentDeleted: true,
        }}
        isOwnBubble={false}
      />,
    );
    const bar = StyleSheet.flatten(getByTestId('wa-reply-quote-bar').props.style);
    // Not one of the six sender hues.
    expect(bar.backgroundColor).not.toBe(waSenderColor('user-2', false));
  });

  test.each([
    ['image', 'Photo'],
    ['video', 'Video'],
    ['audio', 'Voice message'],
    ['document', 'Document'],
  ])('a caption-less %s parent shows "%s"', (type, label) => {
    const { getByTestId } = render(
      <ReplyQuoteBlock
        quote={{ ...baseQuote, parentContent: '', parentAttachmentType: type }}
        isOwnBubble={false}
      />,
    );
    expect(getByTestId('wa-reply-quote-snippet').props.children).toBe(label);
  });

  test('a CAPTIONED media parent shows the caption, not the noun', () => {
    expect(
      resolveQuoteSnippet({
        ...baseQuote,
        parentContent: 'the new chairs',
        parentAttachmentType: 'image',
      }).text,
    ).toBe('the new chairs');
  });

  test('the snippet is never blank', () => {
    expect(resolveQuoteSnippet({ parentMessageId: 'p' as any }).text).toBe('Message');
  });

  test('a media parent with a thumbnail renders it; a deleted one does not', () => {
    const withThumb = render(
      <ReplyQuoteBlock
        quote={{
          ...baseQuote,
          parentContent: '',
          parentAttachmentType: 'image',
          parentThumbnailUrl: 'https://cdn.test/chairs.jpg',
        }}
        isOwnBubble={false}
      />,
    );
    expect(withThumb.queryByTestId('app-image')).not.toBeNull();

    const deleted = render(
      <ReplyQuoteBlock
        quote={{
          ...baseQuote,
          parentDeleted: true,
          parentAttachmentType: 'image',
          parentThumbnailUrl: 'https://cdn.test/chairs.jpg',
        }}
        isOwnBubble={false}
      />,
    );
    expect(deleted.queryByTestId('app-image')).toBeNull();
  });

  test('outgoing bubbles shift the snippet ink off the theme token', () => {
    const incoming = render(
      <ReplyQuoteBlock quote={baseQuote} isOwnBubble={false} />,
    );
    const incomingColor = StyleSheet.flatten(
      incoming.getByTestId('wa-reply-quote-snippet').props.style,
    ).color;

    const outgoing = render(<ReplyQuoteBlock quote={baseQuote} isOwnBubble />);
    const outgoingColor = StyleSheet.flatten(
      outgoing.getByTestId('wa-reply-quote-snippet').props.style,
    ).color;

    // On the tinted outgoing fill the ink is an alpha overlay, not an opaque
    // theme gray — same reasoning as the in-bubble timestamp.
    expect(outgoingColor).toMatch(/^rgba\(/);
    expect(outgoingColor).not.toBe(incomingColor);
  });
});
