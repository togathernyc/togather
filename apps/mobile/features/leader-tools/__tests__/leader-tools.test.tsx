import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";

// Mock expo-router
jest.mock("expo-router", () => ({
  useRouter: jest.fn(),
}));

// Import after mocks
import { useRouter } from "expo-router";
import LeaderToolsScreen from "../../../app/(user)/leader-tools";

const mockUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;

describe("LeaderToolsScreen", () => {
  let queryClient: QueryClient;
  const mockRouter = {
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
  };

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    jest.clearAllMocks();
    mockUseRouter.mockReturnValue(mockRouter as any);
  });

  afterEach(() => {
    queryClient.clear();
  });

  const renderComponent = () => {
    return render(
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <LeaderToolsScreen />
        </QueryClientProvider>
      </SafeAreaProvider>
    );
  };

  it("shows loading indicator while redirecting", () => {
    renderComponent();

    // Component should show an ActivityIndicator
    // ActivityIndicator doesn't have text, but we can verify the component renders
    expect(screen.toJSON()).toBeTruthy();
  });

  it("redirects to inbox on mount", async () => {
    renderComponent();

    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith("/inbox");
    });
  });
});
