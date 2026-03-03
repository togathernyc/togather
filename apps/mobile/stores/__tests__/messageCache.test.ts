/**
 * Tests for messageCache Zustand store
 */
import { useMessageCache } from '../messageCache';

describe('messageCache', () => {
  beforeEach(() => {
    // Reset store between tests
    useMessageCache.getState().clearAll();
  });

  it('setChannelMessages stores messages for a channel', () => {
    const messages = [
      { _id: 'msg-1', content: 'Hello', createdAt: Date.now() },
      { _id: 'msg-2', content: 'World', createdAt: Date.now() },
    ];

    useMessageCache.getState().setChannelMessages('ch-1', messages);

    const result = useMessageCache.getState().getChannelMessages('ch-1');
    expect(result).toHaveLength(2);
    expect(result![0].content).toBe('Hello');
  });

  it('getChannelMessages returns null for unknown channel', () => {
    const result = useMessageCache.getState().getChannelMessages('unknown');
    expect(result).toBeNull();
  });

  it('getChannelMessages returns null for expired cache (>24h)', () => {
    const messages = [
      { _id: 'msg-1', content: 'Old', createdAt: Date.now() },
    ];

    useMessageCache.getState().setChannelMessages('ch-1', messages);

    // Manually set timestamp to 25 hours ago
    const state = useMessageCache.getState();
    const channels = { ...state.channels };
    channels['ch-1'] = {
      ...channels['ch-1'],
      timestamp: Date.now() - 25 * 60 * 60 * 1000,
    };
    useMessageCache.setState({ channels });

    const result = useMessageCache.getState().getChannelMessages('ch-1');
    expect(result).toBeNull();
  });

  it('clearChannel removes a specific channel', () => {
    useMessageCache.getState().setChannelMessages('ch-1', [
      { _id: 'msg-1', content: 'A', createdAt: Date.now() },
    ]);
    useMessageCache.getState().setChannelMessages('ch-2', [
      { _id: 'msg-2', content: 'B', createdAt: Date.now() },
    ]);

    useMessageCache.getState().clearChannel('ch-1');

    expect(
      useMessageCache.getState().getChannelMessages('ch-1')
    ).toBeNull();
    expect(
      useMessageCache.getState().getChannelMessages('ch-2')
    ).not.toBeNull();
  });

  it('clearAll removes all channels', () => {
    useMessageCache.getState().setChannelMessages('ch-1', [
      { _id: 'msg-1', content: 'A', createdAt: Date.now() },
    ]);
    useMessageCache.getState().setChannelMessages('ch-2', [
      { _id: 'msg-2', content: 'B', createdAt: Date.now() },
    ]);

    useMessageCache.getState().clearAll();

    expect(
      useMessageCache.getState().getChannelMessages('ch-1')
    ).toBeNull();
    expect(
      useMessageCache.getState().getChannelMessages('ch-2')
    ).toBeNull();
  });

  it('limits to 50 messages per channel', () => {
    const messages = Array.from({ length: 60 }, (_, i) => ({
      _id: `msg-${i}`,
      content: `Message ${i}`,
      createdAt: Date.now() + i,
    }));

    useMessageCache.getState().setChannelMessages('ch-1', messages);

    const result = useMessageCache.getState().getChannelMessages('ch-1');
    expect(result).toHaveLength(50);
    // Should keep the LATEST 50 messages (last 50 from the sorted array)
    expect(result![0].content).toBe('Message 10');
  });

  it('limits to 20 channels', () => {
    // Add 25 channels
    for (let i = 0; i < 25; i++) {
      useMessageCache.getState().setChannelMessages(`ch-${i}`, [
        {
          _id: `msg-${i}`,
          content: `Message ${i}`,
          createdAt: Date.now() + i,
        },
      ]);
    }

    const channelCount = Object.keys(
      useMessageCache.getState().channels
    ).length;
    expect(channelCount).toBeLessThanOrEqual(20);
  });
});
