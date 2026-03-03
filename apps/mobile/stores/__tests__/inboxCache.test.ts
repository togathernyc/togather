/**
 * Tests for inboxCache Zustand store
 */
import { useInboxCache } from '../inboxCache';

describe('inboxCache', () => {
  beforeEach(() => {
    // Reset store between tests
    useInboxCache.getState().clear();
  });

  it('stores and retrieves inbox channels', () => {
    const mockChannels = [
      {
        group: { _id: 'group-1', name: 'Test Group' },
        channels: [
          {
            _id: 'ch-1',
            slug: 'general',
            name: 'General',
            unreadCount: 0,
          },
        ],
        userRole: 'member',
      },
    ];

    useInboxCache.getState().setInboxChannels('comm-1', mockChannels);

    const result = useInboxCache.getState().getInboxChannels('comm-1');
    expect(result).toEqual(mockChannels);
  });

  it('returns null for non-existent community', () => {
    const result = useInboxCache
      .getState()
      .getInboxChannels('comm-nonexistent');
    expect(result).toBeNull();
  });

  it('returns null for expired cache (>24h)', () => {
    const mockChannels = [
      { group: { _id: 'g-1' }, channels: [], userRole: 'member' },
    ];

    useInboxCache.getState().setInboxChannels('comm-1', mockChannels);

    // Manually set timestamp to 25 hours ago
    const state = useInboxCache.getState();
    const communities = { ...state.communities };
    communities['comm-1'] = {
      ...communities['comm-1'],
      timestamp: Date.now() - 25 * 60 * 60 * 1000,
    };
    useInboxCache.setState({ communities });

    const result = useInboxCache.getState().getInboxChannels('comm-1');
    expect(result).toBeNull();
  });

  it('supports multiple communities', () => {
    const channels1 = [
      { group: { _id: 'g-1', name: 'Group 1' }, channels: [], userRole: 'member' },
    ];
    const channels2 = [
      { group: { _id: 'g-2', name: 'Group 2' }, channels: [], userRole: 'leader' },
    ];

    useInboxCache.getState().setInboxChannels('comm-1', channels1);
    useInboxCache.getState().setInboxChannels('comm-2', channels2);

    expect(useInboxCache.getState().getInboxChannels('comm-1')).toEqual(
      channels1
    );
    expect(useInboxCache.getState().getInboxChannels('comm-2')).toEqual(
      channels2
    );
  });

  it('clears all cached data', () => {
    useInboxCache
      .getState()
      .setInboxChannels('comm-1', [{ group: { _id: 'g-1' } }]);
    useInboxCache
      .getState()
      .setInboxChannels('comm-2', [{ group: { _id: 'g-2' } }]);

    useInboxCache.getState().clear();

    expect(useInboxCache.getState().getInboxChannels('comm-1')).toBeNull();
    expect(useInboxCache.getState().getInboxChannels('comm-2')).toBeNull();
  });

  it('overwrites existing cache for same community', () => {
    const oldChannels = [
      { group: { _id: 'g-1', name: 'Old' }, channels: [], userRole: 'member' },
    ];
    const newChannels = [
      { group: { _id: 'g-1', name: 'New' }, channels: [], userRole: 'leader' },
      { group: { _id: 'g-2', name: 'Extra' }, channels: [], userRole: 'member' },
    ];

    useInboxCache.getState().setInboxChannels('comm-1', oldChannels);
    useInboxCache.getState().setInboxChannels('comm-1', newChannels);

    const result = useInboxCache.getState().getInboxChannels('comm-1');
    expect(result).toEqual(newChannels);
    expect(result).toHaveLength(2);
  });
});
