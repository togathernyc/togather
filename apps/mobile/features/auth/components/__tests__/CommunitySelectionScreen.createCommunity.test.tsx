/**
 * "Create a Community" from the community-selection screen.
 *
 * The screen serves two very different states: an already-signed-in user
 * switching communities, and a brand-new user mid-signup whose account does
 * NOT exist yet (phone verified + profile collected, but `registerNewUser`
 * hasn't run, so there are no auth tokens). Every other action on the screen
 * registers the new user before continuing — "Create a Community" used to
 * just `router.push("/onboarding/demo")`, and the demo wizard's auth gate
 * bounced the tokenless user to the landing screen, dropping their phone/OTP
 * params. From the user's side that looks exactly like being signed out.
 *
 * See: the 2026-08-01 device report ("tried to create a new community, it
 * signed out automatically instead").
 */
import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react-native";
import { CommunitySelectionScreen } from "../CommunitySelectionScreen";

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockParams: Record<string, string> = {};

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useLocalSearchParams: () => mockParams,
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@hooks/useTheme", () => ({
  useTheme: () => ({
    colors: new Proxy({}, { get: () => "#000" }),
    isDark: false,
  }),
}));

const mockSignIn = jest.fn().mockResolvedValue(undefined);
const mockSetCommunity = jest.fn().mockResolvedValue(undefined);
const mockRefreshUser = jest.fn().mockResolvedValue(undefined);
const mockClearCommunity = jest.fn().mockResolvedValue(undefined);
let mockAuthState = { isAuthenticated: false, isLoading: false };

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({
    signIn: mockSignIn,
    setCommunity: mockSetCommunity,
    refreshUser: mockRefreshUser,
    clearCommunity: mockClearCommunity,
    community: null,
    ...mockAuthState,
  }),
}));

const mockRegisterAction = jest.fn();
const mockQuery = jest.fn().mockResolvedValue({ data: [] });

jest.mock("@services/api/convex", () => ({
  useConvex: () => ({ query: mockQuery, action: mockRegisterAction }),
  useAuthenticatedMutation: () => jest.fn().mockResolvedValue(undefined),
  useStoredAuthToken: () => null,
  api: {
    functions: {
      users: { me: "users.me", clearActiveCommunity: "users.clearActiveCommunity" },
      communities: { leave: "communities.leave" },
      resources: { communitySearch: "resources.communitySearch" },
      auth: { registration: { registerNewUser: "auth.registration.registerNewUser" } },
    },
  },
  Id: {},
}));

jest.mock("../../hooks/useAuth", () => ({
  useSelectCommunity: () => ({ mutateAsync: jest.fn().mockResolvedValue(undefined) }),
}));

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

const NEW_USER_PARAMS = {
  isNewUser: "true",
  phone: "5551234567",
  countryCode: "US",
  otp: "123456",
  phoneVerificationToken: "verify-token",
  firstName: "Jamie",
  lastName: "Rivera",
  email: "jamie@example.com",
  birthday: "04/17/1990",
};

describe("CommunitySelectionScreen — Create a Community", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = {};
    mockAuthState = { isAuthenticated: false, isLoading: false };
    mockRegisterAction.mockResolvedValue({
      user: { id: "user_123" },
      access_token: "access-abc",
      refresh_token: "refresh-abc",
    });
    mockQuery.mockResolvedValue({ data: [] });
  });

  it("registers the pending new user before opening the demo wizard", async () => {
    mockParams = { ...NEW_USER_PARAMS };

    const { getByText } = render(<CommunitySelectionScreen />);
    fireEvent.press(getByText("Create a Community"));

    await waitFor(() => expect(mockRegisterAction).toHaveBeenCalled());

    // Registration uses the verified phone/OTP context carried in params, with
    // the birthday normalized to the YYYY-MM-DD the backend expects.
    expect(mockRegisterAction).toHaveBeenCalledWith(
      "auth.registration.registerNewUser",
      expect.objectContaining({
        phone: "5551234567",
        countryCode: "US",
        otp: "123456",
        phoneVerificationToken: "verify-token",
        firstName: "Jamie",
        lastName: "Rivera",
        email: "jamie@example.com",
        dateOfBirth: "1990-04-17",
      })
    );

    // Tokens must be stored via signIn BEFORE the demo route is opened —
    // otherwise the wizard's auth gate bounces the user to landing.
    await waitFor(() =>
      expect(mockSignIn).toHaveBeenCalledWith("user_123", {
        accessToken: "access-abc",
        refreshToken: "refresh-abc",
      })
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/onboarding/demo"));
    expect(mockSignIn.mock.invocationCallOrder[0]).toBeLessThan(
      mockPush.mock.invocationCallOrder[0]
    );
  });

  it("keeps the user on the screen with an error when registration fails", async () => {
    mockParams = { ...NEW_USER_PARAMS };
    mockRegisterAction.mockRejectedValue(new Error("Phone already registered"));

    const { getByText } = render(<CommunitySelectionScreen />);
    fireEvent.press(getByText("Create a Community"));

    await waitFor(() => expect(getByText("Phone already registered")).toBeTruthy());
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("opens the demo wizard directly for an already signed-in user", async () => {
    mockAuthState = { isAuthenticated: true, isLoading: false };

    const { getByText } = render(<CommunitySelectionScreen />);
    fireEvent.press(getByText("Create a Community"));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/onboarding/demo"));
    expect(mockRegisterAction).not.toHaveBeenCalledWith(
      "auth.registration.registerNewUser",
      expect.anything()
    );
    expect(mockSignIn).not.toHaveBeenCalled();
  });
});
