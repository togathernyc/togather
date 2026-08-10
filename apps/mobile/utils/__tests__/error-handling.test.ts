/**
 * Tests for `errorMessage` — the helper every screen uses to turn a thrown
 * Convex error into something a user can act on.
 *
 * The regression that motivated these: `ConvexError("some text")` puts a bare
 * **string** on `.data`, not `{ message }`. A helper that only reads
 * `.data.message` falls through to `.message`, which in production is the
 * opaque "[CONVEX M(...)] [Request ID: ...] Server Error" — so a plain-English
 * "this group is out of channels" surfaced to a leader as a server crash.
 */

import { errorMessage } from '../error-handling';

/** Stand-in for a ConvexError as the client sees it in production. */
function convexError(data: unknown): Error & { data: unknown } {
  const err = new Error(
    '[CONVEX M(functions/scheduling/teams:createServingTeam)] ' +
      '[Request ID: b5986ff0584bae38] Server Error'
  ) as Error & { data: unknown };
  err.data = data;
  return err;
}

describe('errorMessage', () => {
  it('reads a string ConvexError payload', () => {
    const err = convexError(
      'This group has reached the maximum of 20 channels.'
    );
    expect(errorMessage(err, 'fallback')).toBe(
      'This group has reached the maximum of 20 channels.'
    );
  });

  it('reads an object ConvexError payload', () => {
    const err = convexError({ code: 'NOT_FOUND', message: 'Channel not found' });
    expect(errorMessage(err, 'fallback')).toBe('Channel not found');
  });

  it('never surfaces the opaque production Convex message', () => {
    // No usable payload at all — the fallback must win over the "[CONVEX …]
    // Server Error" text, which tells a user nothing and reads as a crash.
    expect(errorMessage(convexError(undefined), 'Please try again.')).toBe(
      'Please try again.'
    );
  });

  it('passes through a plain Error message', () => {
    expect(errorMessage(new Error('Network request failed'), 'fallback')).toBe(
      'Network request failed'
    );
  });

  it('ignores blank payloads', () => {
    expect(errorMessage(convexError('   '), 'fallback')).toBe('fallback');
    expect(errorMessage(convexError({ message: '' }), 'fallback')).toBe(
      'fallback'
    );
  });

  it('falls back for non-error values', () => {
    expect(errorMessage(null, 'fallback')).toBe('fallback');
    expect(errorMessage(undefined, 'fallback')).toBe('fallback');
    expect(errorMessage('a bare string', 'fallback')).toBe('fallback');
  });
});
