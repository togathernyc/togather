import { renderHook, act } from "@testing-library/react-native";
import { Alert } from "react-native";
import { useArchiveGroup } from "../useArchiveGroup";
import { useAuthenticatedMutation } from "@services/api/convex";
import { useRouter } from "expo-router";

jest.mock("@services/api/convex", () => ({
  useAuthenticatedMutation: jest.fn(),
  api: {
    functions: {
      groups: {
        index: {
          update: "api.functions.groups.index.update",
        },
      },
    },
  },
}));

jest.mock("expo-router", () => ({
  useRouter: jest.fn(),
}));

describe("useArchiveGroup", () => {
  const mockUpdateGroup = jest.fn();
  const mockBack = jest.fn();
  const mockReplace = jest.fn();
  const mockCanGoBack = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, "alert").mockImplementation(jest.fn());

    (useAuthenticatedMutation as jest.Mock).mockReturnValue(mockUpdateGroup);
    (useRouter as jest.Mock).mockReturnValue({
      back: mockBack,
      replace: mockReplace,
      canGoBack: mockCanGoBack,
    });
  });

  it("navigates back immediately after a successful archive", async () => {
    mockCanGoBack.mockReturnValue(true);
    mockUpdateGroup.mockResolvedValue(undefined);

    const { result } = renderHook(() => useArchiveGroup("group_123"));

    await act(async () => {
      await result.current.mutate();
    });

    expect(mockUpdateGroup).toHaveBeenCalledWith({
      groupId: "group_123",
      isArchived: true,
    });
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("navigates to /groups when it cannot go back", async () => {
    mockCanGoBack.mockReturnValue(false);
    mockUpdateGroup.mockResolvedValue(undefined);

    const { result } = renderHook(() => useArchiveGroup("group_123"));

    await act(async () => {
      await result.current.mutate();
    });

    expect(mockReplace).toHaveBeenCalledWith("/groups");
    expect(mockBack).not.toHaveBeenCalled();
  });
});
