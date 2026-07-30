import { renderHook } from "@testing-library/react-native";

const mockUseQuery = jest.fn();

jest.mock("@services/api/convex", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  api: {
    functions: {
      meetings: {
        attendance: {
          listAttendance: "listAttendance",
          listGuests: "listGuests",
          canManageAttendance: "canManageAttendance",
        },
      },
    },
  },
}));

jest.mock("@providers/AuthProvider", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

import { useAttendanceReport } from "../useAttendanceReport";

const MEETING_ID = "meeting_1";

/**
 * Wire `useQuery` per Convex function reference. `canManage` drives the
 * permission query; the roster queries return fixtures so we can assert they
 * were (or weren't) subscribed.
 */
function mockQueries(canManage: boolean | undefined) {
  mockUseQuery.mockImplementation((func: string, args: unknown) => {
    if (args === "skip") return undefined;
    if (func === "canManageAttendance") return canManage;
    if (func === "listAttendance") return [];
    if (func === "listGuests") return [];
    return undefined;
  });
}

/** Args the hook passed for a given Convex function, or undefined if unused. */
function argsFor(func: string): unknown {
  const call = mockUseQuery.mock.calls.find(([fn]) => fn === func);
  return call?.[1];
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("useAttendanceReport", () => {
  test("does not read the roster until the permission check resolves", () => {
    mockQueries(undefined);

    const { result } = renderHook(() =>
      useAttendanceReport("group_1", { meetingId: MEETING_ID })
    );

    expect(argsFor("listAttendance")).toBe("skip");
    expect(argsFor("listGuests")).toBe("skip");
    expect(result.current.isPermissionDenied).toBe(false);
    expect(result.current.isLoading).toBe(true);
  });

  test("reports a permission denial instead of subscribing to the roster", () => {
    mockQueries(false);

    const { result } = renderHook(() =>
      useAttendanceReport("group_1", { meetingId: MEETING_ID })
    );

    // listAttendance/listGuests throw server-side for non-managers, which
    // convex/react re-throws during render and crashes the screen.
    expect(argsFor("listAttendance")).toBe("skip");
    expect(argsFor("listGuests")).toBe("skip");
    expect(result.current.isPermissionDenied).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  test("reads the roster once the user is confirmed a manager", () => {
    mockQueries(true);

    const { result } = renderHook(() =>
      useAttendanceReport("group_1", { meetingId: MEETING_ID })
    );

    expect(argsFor("listAttendance")).toEqual({
      meetingId: MEETING_ID,
      token: "test-token",
    });
    expect(result.current.isPermissionDenied).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data?.attendances).toEqual([]);
  });

  test("is not 'loading' when there is nothing to fetch", () => {
    mockQueries(true);

    // The leader-tools entry point deep-links with `?eventDate=` and no
    // meetingId; reporting that as loading pinned the screen on a spinner.
    const { result } = renderHook(() =>
      useAttendanceReport("group_1", { eventDate: "2026-07-19T00:00:00.000Z" })
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  test("skips every query, including the permission check, when disabled", () => {
    mockQueries(true);

    renderHook(() =>
      useAttendanceReport("group_1", { meetingId: MEETING_ID }, false)
    );

    expect(argsFor("canManageAttendance")).toBe("skip");
    expect(argsFor("listAttendance")).toBe("skip");
  });
});
