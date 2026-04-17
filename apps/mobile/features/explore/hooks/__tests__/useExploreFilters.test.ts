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

  it('defaults to no active filters when no params', () => {
    const { result } = renderHook(() => useExploreFilters());
    expect(result.current.filters.groupType).toBeNull();
    expect(result.current.filters.meetingType).toBeNull();
    expect(result.current.hasActiveGroupFilters).toBe(false);
    expect(result.current.activeGroupFilterCount).toBe(0);
  });

  it('reads numeric groupType from URL params', () => {
    mockParams = { groupType: '5' };
    const { result } = renderHook(() => useExploreFilters());
    expect(result.current.filters.groupType).toBe(5);
  });

  it('reads string groupType (Convex ID) from URL params', () => {
    mockParams = { groupType: 'xvht54eke' };
    const { result } = renderHook(() => useExploreFilters());
    expect(result.current.filters.groupType).toBe('xvht54eke');
  });

  it('reads meetingType from URL params', () => {
    mockParams = { meetingType: '2' };
    const { result } = renderHook(() => useExploreFilters());
    expect(result.current.filters.meetingType).toBe(2);
  });

  it('updates URL when setting groupType', () => {
    const { result } = renderHook(() => useExploreFilters());

    act(() => {
      result.current.setFilters({ groupType: 3 });
    });

    expect(mockReplace).toHaveBeenCalledTimes(1);
    const calledUrl = mockReplace.mock.calls[0][0] as string;
    expect(calledUrl).toContain('groupType=3');
  });

  it('uses router.replace (not setParams) to avoid param merging', () => {
    mockParams = { groupType: '5' };
    const { result } = renderHook(() => useExploreFilters());

    act(() => {
      result.current.setFilters({ groupType: 7 });
    });

    expect(mockReplace).toHaveBeenCalled();
    expect(mockSetParams).not.toHaveBeenCalled();
  });

  it('does not call replace when setting same values', () => {
    mockParams = { groupType: '5' };
    const { result } = renderHook(() => useExploreFilters());

    act(() => {
      result.current.setFilters({ groupType: 5 });
    });

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('resetFilters clears all group filter params', () => {
    mockParams = { groupType: '5', meetingType: '2' };
    const { result } = renderHook(() => useExploreFilters());

    act(() => {
      result.current.resetFilters();
    });

    expect(mockReplace).toHaveBeenCalledTimes(1);
    const calledUrl = mockReplace.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain('groupType');
    expect(calledUrl).not.toContain('meetingType');
  });

  it('reports hasActiveGroupFilters when groupType is set', () => {
    mockParams = { groupType: '5' };
    const { result } = renderHook(() => useExploreFilters());
    expect(result.current.hasActiveGroupFilters).toBe(true);
    expect(result.current.activeGroupFilterCount).toBe(1);
  });

  it('reports hasActiveGroupFilters when both filters are set', () => {
    mockParams = { groupType: '5', meetingType: '2' };
    const { result } = renderHook(() => useExploreFilters());
    expect(result.current.hasActiveGroupFilters).toBe(true);
    expect(result.current.activeGroupFilterCount).toBe(2);
  });
});
