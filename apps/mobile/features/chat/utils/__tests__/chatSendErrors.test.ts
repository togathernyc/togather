/**
 * Tests for the centralised chat-send error classifier.
 *
 * The strings being matched here are produced by the Convex backend in
 * `apps/convex/functions/messaging/messages.ts`. If the backend wording
 * changes, these tests must change in lock-step — the whole point of the
 * helper is to keep that coupling discoverable and one-place.
 */

import { ConvexError } from 'convex/values';
import { classifyChatSendError } from '../chatSendErrors';

describe('classifyChatSendError', () => {
  it('classifies attachments-pending as a soft fail', () => {
    const err = new Error(
      'Cannot send attachments until the recipient accepts the request',
    );
    const result = classifyChatSendError(err);
    expect(result.kind).toBe('attachments_pending');
    expect(result.soft).toBe(true);
    expect(result.userMessage).toMatch(/accept your chat request/i);
  });

  it('classifies attachments-pending error wrapped by Convex client', () => {
    // Convex client wraps mutation rejections with extra prefix text like
    // `[CONVEX M(messaging/messages:sendMessage)] [Request ID: xxx] Server
    // Error: Cannot send attachments...`. The substring matcher has to
    // survive that wrapping.
    const err = new Error(
      '[CONVEX M(functions/messaging/messages:sendMessage)] [Request ID: 2a8c318564781741] Server Error: Cannot send attachments until the recipient accepts the request',
    );
    expect(classifyChatSendError(err).kind).toBe('attachments_pending');
  });

  it('classifies pending text-too-long as a soft fail', () => {
    const err = new Error(
      'Messages must be 1000 characters or fewer until the recipient accepts',
    );
    expect(classifyChatSendError(err).kind).toBe('text_too_long_pending');
    expect(classifyChatSendError(err).soft).toBe(true);
  });

  it('classifies request-pending reply as a soft fail', () => {
    expect(
      classifyChatSendError(new Error('Accept the request before replying')).kind,
    ).toBe('request_pending');
  });

  it('classifies caller missing profile photo as soft', () => {
    expect(classifyChatSendError(new Error('PROFILE_PHOTO_REQUIRED')).kind).toBe(
      'profile_photo_self',
    );
  });

  it('disambiguates RECIPIENT_PROFILE_PHOTO_REQUIRED from PROFILE_PHOTO_REQUIRED', () => {
    // Both match the substring "PROFILE_PHOTO_REQUIRED"; the recipient row
    // must come first in the matcher list (it does) so the more specific
    // case wins.
    const err = new Error(
      'RECIPIENT_PROFILE_PHOTO_REQUIRED:abc123',
    );
    expect(classifyChatSendError(err).kind).toBe('profile_photo_recipient');
  });

  it('classifies block-enforcement rejection as soft', () => {
    const err = new Error('Cannot send message in this chat');
    expect(classifyChatSendError(err).kind).toBe('blocked');
    expect(classifyChatSendError(err).soft).toBe(true);
  });

  it('returns unknown/non-soft for unrecognised errors', () => {
    const result = classifyChatSendError(new Error('Network request failed'));
    expect(result.kind).toBe('unknown');
    expect(result.soft).toBe(false);
  });

  it('handles non-Error inputs (string, undefined, null)', () => {
    expect(classifyChatSendError(undefined).kind).toBe('unknown');
    expect(classifyChatSendError(null).kind).toBe('unknown');
    expect(classifyChatSendError('Cannot send attachments yo').kind).toBe(
      'attachments_pending',
    );
  });

  it('handles ConvexError instances (data carries the message)', () => {
    // ConvexError("string") sets .data = "string" but .message also includes
    // it via the prototype. Verify the matcher picks it up either way.
    const err = new ConvexError(
      'Cannot send attachments until the recipient accepts the request',
    );
    expect(classifyChatSendError(err).kind).toBe('attachments_pending');
  });
});
