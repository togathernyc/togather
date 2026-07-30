import React from "react";
import { render } from "@testing-library/react-native";
import { TaskCard } from "../TaskCard";
import type { Id } from "@services/api/convex";

const mockMutation = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
  usePathname: () => "/inbox/group-1/general",
}));

jest.mock("@hooks/useCommunityTheme", () => ({
  useCommunityTheme: () => ({ primaryColor: "#2563EB" }),
}));

jest.mock("@services/api/convex", () => ({
  api: {
    functions: {
      tasks: {
        index: {
          claim: "claim",
          markDone: "markDone",
          assign: "assign",
        },
      },
    },
  },
  useAuthenticatedMutation: () => mockMutation,
}));

describe("TaskCard", () => {
  it("prioritizes task title over generic reminder description", () => {
    const { getByText, queryByText } = render(
      <TaskCard
        variant="leader"
        task={{
          _id: "task-1" as Id<"tasks">,
          groupId: "group-1" as Id<"groups">,
          title: "Set up chairs before service",
          description: "Task reminder generated for thursday",
          status: "open",
          createdAt: Date.now(),
          viewerCanManage: true,
        }}
      />,
    );

    expect(getByText("Set up chairs before service")).toBeTruthy();
    expect(queryByText("Task reminder generated for thursday")).toBeNull();
  });
});
