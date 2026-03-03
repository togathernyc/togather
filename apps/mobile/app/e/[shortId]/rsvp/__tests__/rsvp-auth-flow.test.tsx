import React from "react";
import { render, fireEvent, waitFor, screen } from "@testing-library/react-native";

import RsvpVerifyScreen from "../verify";
import RsvpProfileScreen from "../profile";

// Mocks ----------------------------------------------------------------------

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
};

const mockUseLocalSearchParams = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

const mockUseQuery = jest.fn();
const mockConvexAction = jest.fn();
const mockConvexMutation = jest.fn();
const mockConvexQuery = jest.fn();

jest.mock("@/services/api/convex", () => ({
  api: {
    functions: {
      meetings: {
        index: {
          getByShortId: { _name: "meetings.index.getByShortId" },
        },
      },
      meetingRsvps: { submit: { _name: "meetingRsvps.submit" } },
      users: { me: { _name: "users.me" } },
      auth: {
        phoneOtp: {
          sendPhoneOTP: { _name: "auth.phoneOtp.sendPhoneOTP" },
          verifyPhoneOTP: { _name: "auth.phoneOtp.verifyPhoneOTP" },
        },
        login: {
          phoneLookup: { _name: "auth.login.phoneLookup" },
        },
        registration: {
          registerNewUser: { _name: "auth.registration.registerNewUser" },
        },
      },
    },
  },
  useQuery: (fn: any, args: any) => mockUseQuery(fn, args),
  convexVanilla: {
    action: (...args: any[]) => mockConvexAction(...args),
    mutation: (...args: any[]) => mockConvexMutation(...args),
    query: (...args: any[]) => mockConvexQuery(...args),
  },
}));

const mockSignIn = jest.fn();
const mockRefreshUser = jest.fn();
const mockSetCommunity = jest.fn();

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({
    refreshUser: mockRefreshUser,
    setCommunity: mockSetCommunity,
    signIn: mockSignIn,
  }),
}));

jest.mock("@/features/auth/hooks/useAuth", () => ({
  useSelectCommunity: () => ({
    mutateAsync: jest.fn(),
  }),
}));

jest.mock("@/components/ui/OTPInput", () => {
  const React = require("react");
  const { TextInput } = require("react-native");
  return {
    OTPInput: ({ value, onChange }: any) => (
      <TextInput testID="otp-input" value={value} onChangeText={onChange} />
    ),
  };
});

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async () => "token-123"),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

describe("RSVP phone auth flow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseQuery.mockReturnValue({
      id: "meeting_1",
      rsvpOptions: [{ id: 1, label: "Going", enabled: true }],
    });
    mockConvexQuery.mockResolvedValue({ activeCommunityId: null });
    mockConvexMutation.mockResolvedValue({ success: true });
  });

  it("stores auth via AuthProvider.signIn before submitting RSVP (existing verified user)", async () => {
    mockUseLocalSearchParams.mockReturnValue({
      shortId: "abc",
      phone: "2025550123",
      countryCode: "US",
      optionId: "1",
      exists: "true",
      hasVerifiedPhone: "true",
      userName: "Test User",
      communities: "[]",
    });

    mockConvexAction.mockResolvedValue({
      verified: true,
      access_token: "token-123",
      refresh_token: "refresh-123",
      user: { id: "user_1", activeCommunityId: null },
    });

    render(<RsvpVerifyScreen />);

    fireEvent.changeText(screen.getByTestId("otp-input"), "123456");
    fireEvent.press(screen.getByText("Verify"));

    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith("user_1", {
        accessToken: "token-123",
        refreshToken: "refresh-123",
      });
    });

    await waitFor(() => {
      expect(mockConvexMutation).toHaveBeenCalledWith(
        expect.objectContaining({ _name: "meetingRsvps.submit" }),
        expect.objectContaining({
          token: "token-123",
          meetingId: "meeting_1",
          optionId: 1,
        })
      );
    });

    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith(
        expect.objectContaining({
          pathname: "/e/abc/rsvp/success",
        })
      );
    });
  });

  it("stores auth via AuthProvider.signIn before submitting RSVP (new user registration)", async () => {
    mockUseLocalSearchParams.mockReturnValue({
      shortId: "abc",
      phone: "2025550123",
      countryCode: "US",
      otp: "123456",
      optionId: "1",
    });

    mockConvexAction.mockResolvedValue({
      access_token: "token-123",
      refresh_token: "refresh-123",
      user: { id: "user_new", firstName: "New", lastName: "User" },
    });

    render(<RsvpProfileScreen />);

    fireEvent.changeText(screen.getByPlaceholderText("First name"), "New");
    fireEvent.changeText(screen.getByPlaceholderText("Last name"), "User");
    fireEvent.press(screen.getByText("Continue"));

    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith("user_new", {
        accessToken: "token-123",
        refreshToken: "refresh-123",
      });
    });

    await waitFor(() => {
      expect(mockConvexMutation).toHaveBeenCalledWith(
        expect.objectContaining({ _name: "meetingRsvps.submit" }),
        expect.objectContaining({
          token: "token-123",
          meetingId: "meeting_1",
          optionId: 1,
        })
      );
    });
  });
});

