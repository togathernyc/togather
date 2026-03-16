import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { ToolLinkCard } from "../ToolLinkCard";
import { api } from "@services/api/convex";

const mockUseQuery = jest.fn();
const mockPush = jest.fn();

jest.mock("@services/api/convex", () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  api: {
    functions: {
      toolShortLinks: {
        index: {
          getByShortId: "api.functions.toolShortLinks.index.getByShortId",
        },
      },
    },
  },
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

describe("ToolLinkCard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders task link details and opens task detail route", () => {
    mockUseQuery.mockImplementation((queryName: unknown) => {
      if (queryName === api.functions.toolShortLinks.index.getByShortId) {
        return {
          shortId: "task123",
          toolType: "task",
          groupId: "group_1",
          groupName: "Leaders Group",
          taskId: "task_9",
          taskTitle: "Call first-time guest",
          taskStatus: "open",
        };
      }
      return undefined;
    });

    const { getByText } = render(<ToolLinkCard shortId="task123" />);
    const label = getByText("Leaders Group | Task: Call first-time guest (open)");

    fireEvent.press(label);

    expect(mockPush).toHaveBeenCalledWith("/(user)/leader-tools/group_1/tasks/task_9");
  });

  it("falls back to public /t route when task id is missing", () => {
    mockUseQuery.mockImplementation((queryName: unknown) => {
      if (queryName === api.functions.toolShortLinks.index.getByShortId) {
        return {
          shortId: "task123",
          toolType: "task",
          groupId: "group_1",
          groupName: "Leaders Group",
          taskTitle: "Call first-time guest",
        };
      }
      return undefined;
    });

    const { getByText } = render(<ToolLinkCard shortId="task123" />);
    fireEvent.press(getByText("Leaders Group | Task: Call first-time guest"));

    expect(mockPush).toHaveBeenCalledWith("/t/task123");
  });
});
