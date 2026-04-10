import { renderHook } from "@testing-library/react-native";
import {
  useMyPendingJoinRequests,
  PENDING_JOIN_REQUEST_LIMIT,
} from "../useMyPendingJoinRequests";

const mockUseQuery = jest.fn();
const mockUseAuth = jest.fn();

jest.mock("@services/api/convex", () => ({
  useQuery: (...args: any[]) => mockUseQuery(...args),
  api: {
    functions: {
      groupMembers: {
        listMyPendingJoinRequests: "api.functions.groupMembers.listMyPendingJoinRequests",
      },
    },
  },
}));

jest.mock("@providers/AuthProvider", () => ({
  useAuth: () => mockUseAuth(),
}));

describe("useMyPendingJoinRequests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({
      token: "test-token",
      community: { id: "comm-1" },
    });
  });

  it("passes token + communityId to the Convex query", () => {
    mockUseQuery.mockReturnValue([]);

    renderHook(() => useMyPendingJoinRequests());

    expect(mockUseQuery).toHaveBeenCalledWith(
      "api.functions.groupMembers.listMyPendingJoinRequests",
      { token: "test-token", communityId: "comm-1" }
    );
  });

  it("returns empty list + count 0 when there are no pending requests", () => {
    mockUseQuery.mockReturnValue([]);

    const { result } = renderHook(() => useMyPendingJoinRequests());

    expect(result.current.requests).toEqual([]);
    expect(result.current.count).toBe(0);
    expect(result.current.isAtLimit).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it("returns isAtLimit=false when count is below the cap", () => {
    mockUseQuery.mockReturnValue([
      { id: "1", groupId: "g1", groupName: "A", groupTypeName: "DP", requestedAt: 1 },
    ]);

    const { result } = renderHook(() => useMyPendingJoinRequests());

    expect(result.current.count).toBe(1);
    expect(result.current.isAtLimit).toBe(false);
  });

  it("returns isAtLimit=true when count reaches the cap", () => {
    mockUseQuery.mockReturnValue([
      { id: "1", groupId: "g1", groupName: "A", groupTypeName: "DP", requestedAt: 2 },
      { id: "2", groupId: "g2", groupName: "B", groupTypeName: "Team", requestedAt: 1 },
    ]);

    const { result } = renderHook(() => useMyPendingJoinRequests());

    expect(result.current.count).toBe(PENDING_JOIN_REQUEST_LIMIT);
    expect(result.current.isAtLimit).toBe(true);
  });

  it("skips the query when there is no token (unauthenticated)", () => {
    mockUseAuth.mockReturnValue({ token: null, community: { id: "comm-1" } });
    mockUseQuery.mockReturnValue(undefined);

    const { result } = renderHook(() => useMyPendingJoinRequests());

    expect(mockUseQuery).toHaveBeenCalledWith(
      "api.functions.groupMembers.listMyPendingJoinRequests",
      "skip"
    );
    expect(result.current.requests).toEqual([]);
    expect(result.current.isAtLimit).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it("skips the query when there is no active community", () => {
    mockUseAuth.mockReturnValue({ token: "test-token", community: null });
    mockUseQuery.mockReturnValue(undefined);

    const { result } = renderHook(() => useMyPendingJoinRequests());

    expect(mockUseQuery).toHaveBeenCalledWith(
      "api.functions.groupMembers.listMyPendingJoinRequests",
      "skip"
    );
    expect(result.current.isLoading).toBe(false);
  });

  it("reports isLoading while the query is undefined", () => {
    mockUseQuery.mockReturnValue(undefined);

    const { result } = renderHook(() => useMyPendingJoinRequests());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.requests).toEqual([]);
  });

  it("PENDING_JOIN_REQUEST_LIMIT is exported and equals 2", () => {
    expect(PENDING_JOIN_REQUEST_LIMIT).toBe(2);
  });
});
