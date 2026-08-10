// jest.setup.js registers a global `jest.mock('./services/api/convex', ...)`
// stand-in (used by every other test file that imports hooks like useQuery
// from this module) that does NOT export `isCommunityArchivedError`. Unmock
// here so this file exercises the real implementation.
jest.unmock('@services/api/convex');

import { isCommunityArchivedError } from '@services/api/convex';

describe('isCommunityArchivedError', () => {
  it('matches when .data is exactly the COMMUNITY_ARCHIVED code', () => {
    expect(isCommunityArchivedError({ data: 'COMMUNITY_ARCHIVED' })).toBe(true);
  });

  it('matches via the .message fallback on a word-boundary hit', () => {
    expect(
      isCommunityArchivedError({
        message: 'ConvexError: [Request ID: abc] Server Error\nCOMMUNITY_ARCHIVED',
      })
    ).toBe(true);
  });

  it('does not match a loose substring embedded in an unrelated code', () => {
    expect(
      isCommunityArchivedError({ data: 'SOME_OTHER_COMMUNITY_ARCHIVED_VARIANT' })
    ).toBe(false);
    expect(
      isCommunityArchivedError({
        message: 'NOT_COMMUNITY_ARCHIVED_AT_ALL: unrelated failure',
      })
    ).toBe(false);
  });

  it('does not match an unrelated error even if .data is a different string', () => {
    expect(isCommunityArchivedError({ data: 'SOME_OTHER_ERROR' })).toBe(false);
    expect(isCommunityArchivedError({ message: 'Network request failed' })).toBe(
      false
    );
  });

  it('returns false for non-object / nullish input', () => {
    expect(isCommunityArchivedError(null)).toBe(false);
    expect(isCommunityArchivedError(undefined)).toBe(false);
    expect(isCommunityArchivedError('COMMUNITY_ARCHIVED')).toBe(false);
    expect(isCommunityArchivedError(42)).toBe(false);
  });

  it('returns false for an object with neither .data nor .message', () => {
    expect(isCommunityArchivedError({})).toBe(false);
    expect(isCommunityArchivedError({ foo: 'bar' })).toBe(false);
  });
});
