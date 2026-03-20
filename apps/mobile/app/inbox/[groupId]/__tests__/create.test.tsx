/**
 * Tests for Create Channel Screen
 *
 * Route: /inbox/[groupId]/create
 *
 * Tests the channel creation form including:
 * - Form field rendering and validation
 * - Character count limits
 * - Create button disabled/enabled states
 * - Mutation calls and error handling
 * - Navigation on success
 */
import React from "react";
import { render, fireEvent, waitFor, act } from "@testing-library/react-native";

// Mock modules BEFORE importing component
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockCanGoBack = jest.fn(() => true);

jest.mock("expo-router", () => ({
  useRouter: () => ({
    replace: mockReplace,
    back: mockBack,
    canGoBack: mockCanGoBack,
  }),
  useLocalSearchParams: () => ({ groupId: "test-group-id" }),
}));

// Mock AuthProvider
jest.mock("@providers/AuthProvider", () => ({
  useAuth: () => ({
    token: "mock-token",
    user: { id: "user-1", displayName: "Current User" },
    community: { id: "test-community-id" },
  }),
}));

// Mock useCommunityTheme
jest.mock("@hooks/useCommunityTheme", () => ({
  useCommunityTheme: () => ({
    primaryColor: "#007AFF",
  }),
}));

// Mock PcoAutoChannelConfig component
jest.mock("@features/channels", () => ({
  PcoAutoChannelConfig: () => null,
}));

// Mock the authenticated mutation hook and useQuery
const mockCreateChannel = jest.fn();
const mockCreateAutoChannel = jest.fn();
const mockGroupData = {
  _id: "test-group-id",
  name: "Test Group",
  communityId: "test-community-id",
};

jest.mock("@services/api/convex", () => ({
  useAuthenticatedMutation: (fn: any) => {
    if (fn === "createCustomChannel") return mockCreateChannel;
    if (fn === "createAutoChannel") return mockCreateAutoChannel;
    return mockCreateChannel;
  },
  useQuery: (fn: any, args: any) => {
    if (args === "skip") return undefined;
    if (fn === "getById") return mockGroupData;
    return mockGroupData;
  },
  api: {
    functions: {
      messaging: {
        channels: {
          createCustomChannel: "createCustomChannel",
          createAutoChannel: "createAutoChannel",
        },
      },
      groups: {
        index: {
          getById: "getById",
        },
      },
    },
  },
}));

// Mock useSafeAreaInsets
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

// Mock Button component to simplify testing
jest.mock("@components/ui", () => ({
  Button: ({ onPress, disabled, loading, children }: any) => {
    const { TouchableOpacity, Text, ActivityIndicator } = require("react-native");
    return (
      <TouchableOpacity
        onPress={onPress}
        disabled={disabled || loading}
        testID="create-button"
        accessibilityState={{ disabled: disabled || loading }}
      >
        {loading ? <ActivityIndicator /> : <Text>{children}</Text>}
      </TouchableOpacity>
    );
  },
}));

// Mock Toast component
jest.mock("@components/ui/Toast", () => ({
  Toast: ({ visible, message, type }: any) => {
    if (!visible) return null;
    const { Text, View } = require("react-native");
    return (
      <View testID="toast">
        <Text testID="toast-message">{message}</Text>
        <Text testID="toast-type">{type}</Text>
      </View>
    );
  },
}));

// Import component AFTER mocks
import CreateChannelScreen from "../create";

describe("CreateChannelScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateChannel.mockReset();
  });

  describe("Form Rendering", () => {
    it("renders the header with correct title", () => {
      const { getAllByText } = render(<CreateChannelScreen />);
      // There are two instances: header title and button text
      const elements = getAllByText("Create Channel");
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });

    it("renders channel name input field", () => {
      const { getByPlaceholderText } = render(<CreateChannelScreen />);
      expect(getByPlaceholderText("Enter channel name")).toBeTruthy();
    });

    it("renders description input field", () => {
      const { getByPlaceholderText } = render(<CreateChannelScreen />);
      expect(getByPlaceholderText("Add a description (optional)")).toBeTruthy();
    });

    it("renders required asterisk for channel name", () => {
      const { getByText } = render(<CreateChannelScreen />);
      expect(getByText("*")).toBeTruthy();
    });

    it("shows helper text about name being permanent", () => {
      const { getByText } = render(<CreateChannelScreen />);
      expect(getByText("Channel names cannot be changed after creation")).toBeTruthy();
    });

    it("shows initial character count", () => {
      const { getByText } = render(<CreateChannelScreen />);
      expect(getByText("0/50")).toBeTruthy();
    });
  });

  describe("Character Count", () => {
    it("updates character count when typing", () => {
      const { getByPlaceholderText, getByText } = render(<CreateChannelScreen />);
      const nameInput = getByPlaceholderText("Enter channel name");

      act(() => {
        fireEvent.changeText(nameInput, "Test");
      });

      expect(getByText("4/50")).toBeTruthy();
    });

    it("updates character count for longer text", () => {
      const { getByPlaceholderText, getByText } = render(<CreateChannelScreen />);
      const nameInput = getByPlaceholderText("Enter channel name");

      act(() => {
        fireEvent.changeText(nameInput, "Test Channel Name");
      });

      expect(getByText("17/50")).toBeTruthy();
    });

    it("enforces maximum character limit of 50", () => {
      const { getByPlaceholderText, queryByText } = render(<CreateChannelScreen />);
      const nameInput = getByPlaceholderText("Enter channel name");

      // The component limits input via maxLength and onChangeText
      // Enter exactly 50 characters which should be accepted
      const maxText = "A".repeat(50);
      act(() => {
        fireEvent.changeText(nameInput, maxText);
      });

      // Should show 50/50
      expect(queryByText("50/50")).toBeTruthy();

      // Try to enter text longer than 50 characters - the component's onChangeText
      // will reject it and keep the previous value
      const longText = "B".repeat(60);
      act(() => {
        fireEvent.changeText(nameInput, longText);
      });

      // Should still show 50/50 (the new text was rejected)
      expect(queryByText("50/50")).toBeTruthy();
    });
  });

  describe("Create Button State", () => {
    it("disables create button when name is empty", () => {
      const { getByTestId } = render(<CreateChannelScreen />);
      const createButton = getByTestId("create-button");

      expect(createButton.props.accessibilityState?.disabled).toBe(true);
    });

    it("disables create button when name is only whitespace", () => {
      const { getByPlaceholderText, getByTestId } = render(<CreateChannelScreen />);
      const nameInput = getByPlaceholderText("Enter channel name");

      act(() => {
        fireEvent.changeText(nameInput, "   ");
      });

      const createButton = getByTestId("create-button");
      expect(createButton.props.accessibilityState?.disabled).toBe(true);
    });

    it("enables create button when valid name is entered", () => {
      const { getByPlaceholderText, getByTestId } = render(<CreateChannelScreen />);
      const nameInput = getByPlaceholderText("Enter channel name");

      act(() => {
        fireEvent.changeText(nameInput, "Test Channel");
      });

      const createButton = getByTestId("create-button");
      expect(createButton.props.accessibilityState?.disabled).toBe(false);
    });
  });

  describe("Channel Creation", () => {
    it("calls createChannel mutation with correct parameters", async () => {
      mockCreateChannel.mockResolvedValueOnce({ slug: "test-channel" });

      const { getByPlaceholderText, getByTestId } = render(<CreateChannelScreen />);
      const nameInput = getByPlaceholderText("Enter channel name");
      const descriptionInput = getByPlaceholderText("Add a description (optional)");

      act(() => {
        fireEvent.changeText(nameInput, "Test Channel");
        fireEvent.changeText(descriptionInput, "Test description");
      });

      const createButton = getByTestId("create-button");
      await act(async () => {
        fireEvent.press(createButton);
      });

      await waitFor(() => {
        expect(mockCreateChannel).toHaveBeenCalledWith({
          groupId: "test-group-id",
          name: "Test Channel",
          description: "Test description",
          joinMode: "open",
        });
      });
    });

    it("trims whitespace from name and description", async () => {
      mockCreateChannel.mockResolvedValueOnce({ slug: "test-channel" });

      const { getByPlaceholderText, getByTestId } = render(<CreateChannelScreen />);
      const nameInput = getByPlaceholderText("Enter channel name");
      const descriptionInput = getByPlaceholderText("Add a description (optional)");

      act(() => {
        fireEvent.changeText(nameInput, "  Test Channel  ");
        fireEvent.changeText(descriptionInput, "  Test description  ");
      });

      const createButton = getByTestId("create-button");
      await act(async () => {
        fireEvent.press(createButton);
      });

      await waitFor(() => {
        expect(mockCreateChannel).toHaveBeenCalledWith({
          groupId: "test-group-id",
          name: "Test Channel",
          description: "Test description",
          joinMode: "open",
        });
      });
    });

    it("omits description when empty", async () => {
      mockCreateChannel.mockResolvedValueOnce({ slug: "test-channel" });

      const { getByPlaceholderText, getByTestId } = render(<CreateChannelScreen />);
      const nameInput = getByPlaceholderText("Enter channel name");

      act(() => {
        fireEvent.changeText(nameInput, "Test Channel");
      });

      const createButton = getByTestId("create-button");
      await act(async () => {
        fireEvent.press(createButton);
      });

      await waitFor(() => {
        expect(mockCreateChannel).toHaveBeenCalledWith({
          groupId: "test-group-id",
          name: "Test Channel",
          description: undefined,
          joinMode: "open",
        });
      });
    });

    it("navigates to new channel on success", async () => {
      mockCreateChannel.mockResolvedValueOnce({ slug: "my-new-channel" });

      const { getByPlaceholderText, getByTestId } = render(<CreateChannelScreen />);
      const nameInput = getByPlaceholderText("Enter channel name");

      act(() => {
        fireEvent.changeText(nameInput, "My New Channel");
      });

      const createButton = getByTestId("create-button");
      await act(async () => {
        fireEvent.press(createButton);
      });

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith("/inbox/test-group-id/my-new-channel");
      });
    });
  });

  describe("Error Handling", () => {
    it("shows toast with 'only leaders' error message", async () => {
      mockCreateChannel.mockRejectedValueOnce(
        new Error("Only group leaders can create channels")
      );

      const { getByPlaceholderText, getByTestId, findByTestId } = render(
        <CreateChannelScreen />
      );
      const nameInput = getByPlaceholderText("Enter channel name");

      act(() => {
        fireEvent.changeText(nameInput, "Test Channel");
      });

      const createButton = getByTestId("create-button");
      await act(async () => {
        fireEvent.press(createButton);
      });

      const toastMessage = await findByTestId("toast-message");
      expect(toastMessage.props.children).toBe("Only group leaders can create channels.");
    });

    it("shows toast with 'maximum channels' error message", async () => {
      mockCreateChannel.mockRejectedValueOnce(
        new Error("This group has reached the maximum of 20 channels")
      );

      const { getByPlaceholderText, getByTestId, findByTestId } = render(
        <CreateChannelScreen />
      );
      const nameInput = getByPlaceholderText("Enter channel name");

      act(() => {
        fireEvent.changeText(nameInput, "Test Channel");
      });

      const createButton = getByTestId("create-button");
      await act(async () => {
        fireEvent.press(createButton);
      });

      const toastMessage = await findByTestId("toast-message");
      expect(toastMessage.props.children).toBe(
        "This group has reached the maximum of 20 channels. Archive some channels to create new ones."
      );
    });

    it("shows toast with 'character limit' error message", async () => {
      mockCreateChannel.mockRejectedValueOnce(
        new Error("Channel name must be 1-50 characters")
      );

      const { getByPlaceholderText, getByTestId, findByTestId } = render(
        <CreateChannelScreen />
      );
      const nameInput = getByPlaceholderText("Enter channel name");

      act(() => {
        fireEvent.changeText(nameInput, "Test");
      });

      const createButton = getByTestId("create-button");
      await act(async () => {
        fireEvent.press(createButton);
      });

      const toastMessage = await findByTestId("toast-message");
      expect(toastMessage.props.children).toBe(
        "Channel name must be between 1 and 50 characters."
      );
    });

    it("shows toast with 'not authenticated' error message", async () => {
      mockCreateChannel.mockRejectedValueOnce(new Error("Not authenticated"));

      const { getByPlaceholderText, getByTestId, findByTestId } = render(
        <CreateChannelScreen />
      );
      const nameInput = getByPlaceholderText("Enter channel name");

      act(() => {
        fireEvent.changeText(nameInput, "Test");
      });

      const createButton = getByTestId("create-button");
      await act(async () => {
        fireEvent.press(createButton);
      });

      const toastMessage = await findByTestId("toast-message");
      expect(toastMessage.props.children).toBe(
        "Please log in again to create a channel."
      );
    });

    it("shows generic error message for unknown errors", async () => {
      mockCreateChannel.mockRejectedValueOnce(new Error("Unknown error occurred"));

      const { getByPlaceholderText, getByTestId, findByTestId } = render(
        <CreateChannelScreen />
      );
      const nameInput = getByPlaceholderText("Enter channel name");

      act(() => {
        fireEvent.changeText(nameInput, "Test");
      });

      const createButton = getByTestId("create-button");
      await act(async () => {
        fireEvent.press(createButton);
      });

      const toastMessage = await findByTestId("toast-message");
      expect(toastMessage.props.children).toBe("Unknown error occurred");
    });

    it("sets toast type to error", async () => {
      mockCreateChannel.mockRejectedValueOnce(new Error("Test error"));

      const { getByPlaceholderText, getByTestId, findByTestId } = render(
        <CreateChannelScreen />
      );
      const nameInput = getByPlaceholderText("Enter channel name");

      act(() => {
        fireEvent.changeText(nameInput, "Test");
      });

      const createButton = getByTestId("create-button");
      await act(async () => {
        fireEvent.press(createButton);
      });

      const toastType = await findByTestId("toast-type");
      expect(toastType.props.children).toBe("error");
    });
  });

  describe("Navigation", () => {
    it("navigates back when back button is pressed and can go back", () => {
      mockCanGoBack.mockReturnValue(true);

      const { getByText } = render(<CreateChannelScreen />);

      // Find the back button by finding parent with arrow-back icon
      // Since Ionicons is mocked, we look for the icon name text
      const backIcon = getByText("arrow-back");
      const backButton = backIcon.parent?.parent;

      if (backButton) {
        act(() => {
          fireEvent.press(backButton);
        });

        expect(mockBack).toHaveBeenCalled();
      }
    });

    it("navigates to general channel when back button is pressed and cannot go back", () => {
      mockCanGoBack.mockReturnValue(false);

      const { getByText } = render(<CreateChannelScreen />);

      const backIcon = getByText("arrow-back");
      const backButton = backIcon.parent?.parent;

      if (backButton) {
        act(() => {
          fireEvent.press(backButton);
        });

        expect(mockReplace).toHaveBeenCalledWith("/inbox/test-group-id/general");
      }
    });
  });

  describe("Loading State", () => {
    it("disables input fields while loading", async () => {
      // Create a promise that we can control
      let resolveCreateChannel: (value: any) => void;
      const createChannelPromise = new Promise((resolve) => {
        resolveCreateChannel = resolve;
      });
      mockCreateChannel.mockReturnValueOnce(createChannelPromise);

      const { getByPlaceholderText, getByTestId } = render(<CreateChannelScreen />);
      const nameInput = getByPlaceholderText("Enter channel name");

      act(() => {
        fireEvent.changeText(nameInput, "Test Channel");
      });

      const createButton = getByTestId("create-button");

      // Start the mutation
      act(() => {
        fireEvent.press(createButton);
      });

      // During loading, button should be disabled
      await waitFor(() => {
        expect(createButton.props.accessibilityState?.disabled).toBe(true);
      });

      // Resolve the promise to complete the test
      await act(async () => {
        resolveCreateChannel!({ slug: "test-channel" });
        await createChannelPromise;
      });
    });
  });
});
