import { renderHook, act } from '@testing-library/react-native';

const mockReplace = jest.fn();
const mockSetParams = jest.fn();
let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn(() => mockParams),
  useRouter: jest.fn(() => ({
    replace: mockReplace,
    setParams: mockSetParams,
    push: jest.fn(),
    back: jest.fn(),
  })),
}));

import { useExploreFilters } from '../useExploreFilters';

describe('useExploreFilters', () => {
  beforeEach(() => {
    mockParams = {};
    mockReplace.mockClear();
    mockSetParams.mockClear();
  });

  it('defaults to groups view when no params', () => {
    const { result } = renderHook(() => useExploreFilters());
    expect(result.current.filters.view).toBe('groups');
  });

  it('reads view from URL params', () => {
    mockParams = { view: 'events' };
    const { result } = renderHook(() => useExploreFilters());
    expect(result.current.filters.view).toBe('events');
  });

  describe('ViewToggle fix - switching back to groups', () => {
    it('explicitly includes view=groups in URL when switching to groups', () => {
      // Start with events view
      mockParams = { view: 'events' };
      const { result } = renderHook(() => useExploreFilters());

      act(() => {
        result.current.setFilters({ view: 'groups' });
      });

      // The critical assertion: view=groups must be in the URL
      // Previously, view was omitted for 'groups' (default), causing
      // Expo Router param merge to keep stale view=events
      expect(mockReplace).toHaveBeenCalledTimes(1);
      const calledUrl = mockReplace.mock.calls[0][0] as string;
      expect(calledUrl).toContain('view=groups');
    });

    it('explicitly includes view=events in URL when switching to events', () => {
      mockParams = {};
      const { result } = renderHook(() => useExploreFilters());

      act(() => {
        result.current.setFilters({ view: 'events' });
      });

      expect(mockReplace).toHaveBeenCalledTimes(1);
      const calledUrl = mockReplace.mock.calls[0][0] as string;
      expect(calledUrl).toContain('view=events');
    });

    it('uses router.replace (not setParams) to avoid param merging', () => {
      mockParams = { view: 'events' };
      const { result } = renderHook(() => useExploreFilters());

      act(() => {
        result.current.setFilters({ view: 'groups' });
      });

      // Must use replace, not setParams
      expect(mockReplace).toHaveBeenCalled();
      expect(mockSetParams).not.toHaveBeenCalled();
    });
  });

  describe('resetFilters', () => {
    it('always includes view param when resetting', () => {
      mockParams = { view: 'events', dateFilter: 'this_week' };
      const { result } = renderHook(() => useExploreFilters());

      act(() => {
        result.current.resetFilters();
      });

      expect(mockReplace).toHaveBeenCalledTimes(1);
      const calledUrl = mockReplace.mock.calls[0][0] as string;
      expect(calledUrl).toContain('view=events');
      expect(calledUrl).not.toContain('dateFilter');
    });

    it('includes view=groups when resetting from groups view', () => {
      mockParams = { groupType: '5' };
      const { result } = renderHook(() => useExploreFilters());

      act(() => {
        result.current.resetFilters();
      });

      expect(mockReplace).toHaveBeenCalledTimes(1);
      const calledUrl = mockReplace.mock.calls[0][0] as string;
      expect(calledUrl).toContain('view=groups');
    });
  });

  describe('skips update when nothing changed', () => {
    it('does not call replace when setting same view', () => {
      mockParams = { view: 'events' };
      const { result } = renderHook(() => useExploreFilters());

      act(() => {
        result.current.setFilters({ view: 'events' });
      });

      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  describe('mode locking', () => {
    it('uses mode as view when mode is set', () => {
      mockParams = { mode: 'events' };
      const { result } = renderHook(() => useExploreFilters());
      expect(result.current.filters.view).toBe('events');
      expect(result.current.isModeLocked).toBe(true);
    });

    it('does not include view param when mode is set', () => {
      mockParams = { mode: 'events' };
      const { result } = renderHook(() => useExploreFilters());

      act(() => {
        result.current.setFilters({ dateFilter: 'this_week' });
      });

      expect(mockReplace).toHaveBeenCalledTimes(1);
      const calledUrl = mockReplace.mock.calls[0][0] as string;
      expect(calledUrl).toContain('mode=events');
      expect(calledUrl).not.toMatch(/[?&]view=/);
    });
  });
});
