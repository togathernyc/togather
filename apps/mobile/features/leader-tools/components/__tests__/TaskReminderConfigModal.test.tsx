import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Keyboard, Platform } from "react-native";
import { TaskReminderConfigModal } from "../TaskReminderConfigModal";
import { useAuthenticatedMutation, useAuthenticatedQuery, useQuery } from "@services/api/convex";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@hooks/useCommunityTheme", () => ({
  useCommunityTheme: () => ({ primaryColor: "#2563EB" }),
}));

jest.mock("@providers/AuthProvider", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

jest.mock("@services/api/convex", () => ({
  api: {
    functions: {
      groupBots: {
        getConfig: "api.functions.groupBots.getConfig",
        updateConfig: "api.functions.groupBots.updateConfig",
      },
      groups: {
        index: {
          getLeaders: "api.functions.groups.index.getLeaders",
        },
      },
      groupMembers: {
        list: "api.functions.groupMembers.list",
      },
      messaging: {
        channels: {
          listGroupChannels: "api.functions.messaging.channels.listGroupChannels",
        },
      },
    },
  },
  useQuery: jest.fn(),
  useAuthenticatedQuery: jest.fn(),
  useAuthenticatedMutation: jest.fn(),
}));

describe("TaskReminderConfigModal keyboard UX", () => {
  const defaultProps = {
    visible: true,
    onClose: jest.fn(),
    groupId: "group-1",
  };

  beforeEach(() => {
    jest.clearAllMocks();

    (useQuery as jest.Mock).mockImplementation((queryKey: string) => {
      if (queryKey === "api.functions.groupBots.getConfig") {
        return {
          config: {
            roles: [],
            schedule: {
              monday: [],
              tuesday: [],
              wednesday: [],
              thursday: [],
              friday: [],
              saturday: [],
              sunday: [],
            },
            deliveryMode: "task_and_channel_post",
            targetChannelSlugs: [],
          },
        };
      }

      if (queryKey === "api.functions.groups.index.getLeaders") {
        return [];
      }

      if (queryKey === "api.functions.groupMembers.list") {
        return { items: [] };
      }

      return undefined;
    });

    (useAuthenticatedQuery as jest.Mock).mockReturnValue([]);
    (useAuthenticatedMutation as jest.Mock).mockReturnValue(jest.fn());
  });

  it("sets keyboard dismiss mode on the main config scroll view", () => {
    render(<TaskReminderConfigModal {...defaultProps} />);
    const mainScroll = screen.getByTestId("task-reminder-config-scroll");

    expect(mainScroll.props.keyboardDismissMode).toBe(
      Platform.OS === "ios" ? "interactive" : "on-drag"
    );
  });

  it("lets users dismiss keyboard from task editor backdrop", () => {
    const dismissSpy = jest.spyOn(Keyboard, "dismiss");

    render(<TaskReminderConfigModal {...defaultProps} />);

    fireEvent.press(screen.getAllByText("Add")[1]);

    const taskEditorScroll = screen.getByTestId("task-editor-scroll");
    expect(taskEditorScroll.props.keyboardDismissMode).toBe(
      Platform.OS === "ios" ? "interactive" : "on-drag"
    );

    fireEvent.press(screen.getByTestId("task-editor-backdrop"));
    expect(dismissSpy).toHaveBeenCalled();
    dismissSpy.mockRestore();
  });
});
