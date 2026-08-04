/**
 * SettingsContent — navigation out of the `(user)` settings modal.
 *
 * `SettingsContent` renders in both shells. In the WhatsApp one it sits inside
 * `/(user)/you/admin/community`, i.e. inside the `(user)` route group that
 * `app/_layout.tsx` declares `presentation: "modal"`. A native modal sits above
 * EVERY navigator screen, so a plain `router.push` to a ROOT-stack route lands
 * the destination *behind* the still-open settings modal on iOS — the founder's
 * report: "when clicking card provider, community finance and financial
 * controls the page opens up behind the modal".
 *
 * These tests pin the fix: every `/finance-setup/*` quick link dismisses the
 * modal stack BEFORE pushing, while destinations that stay inside `(user)`
 * keep their plain push (dismissing those would tear down the stack they
 * belong to).
 */
import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { SettingsContent } from "../SettingsContent";

const mockPush = jest.fn();
const mockDismissAll = jest.fn();
const mockCanDismiss = jest.fn(() => true);
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: mockPush,
    back: jest.fn(),
    canGoBack: () => true,
    canDismiss: mockCanDismiss,
    dismissAll: mockDismissAll,
  }),
}));

jest.mock("@services/api/convex", () => ({
  api: {
    functions: {
      admin: { featureFlags: { getFeatureFlag: "flags.getFeatureFlag" } },
      ee: { billing: { getSubscriptionStatus: "billing.getSubscriptionStatus" } },
      memberActivity: { getBillableSummary: "memberActivity.getBillableSummary" },
    },
  },
  // Only the group-giving flag matters here: it gates the finance quick links.
  useQuery: (ref: string) => (ref === "flags.getFeatureFlag" ? true : undefined),
}));

jest.mock("@togather/shared/config", () => ({
  DOMAIN_CONFIG: { landingUrl: "https://example.test" },
}));

jest.mock("expo-localization", () => ({
  getLocales: () => [{ regionCode: "US" }],
}));

jest.mock("expo-linking", () => ({ openURL: jest.fn() }));

jest.mock("expo-file-system/legacy", () => ({
  uploadAsync: jest.fn(),
  FileSystemUploadType: { BINARY_CONTENT: "binary" },
}));

jest.mock("@components/ui", () => ({ ImagePicker: () => null }));

jest.mock("../GroupTypeEditModal", () => ({ GroupTypeEditModal: () => null }));
jest.mock("../ArchiveCommunityModal", () => ({ ArchiveCommunityModal: () => null }));
jest.mock("../ColorPicker", () => ({ ColorPicker: () => null }));
jest.mock("../ColorPreview", () => ({ ColorPreview: () => null }));

// The hook results are FROZEN module-level singletons, not fresh objects per
// call. `SettingsContent` has a `useEffect` keyed on `settings` that sets
// state, so a mock returning a new object every render re-runs that effect
// forever and the test process dies of heap exhaustion rather than failing.
jest.mock("../../hooks", () => {
  const settings = {
    name: "Demo Community",
    subdomain: "demo",
    churchFeatures: {},
  };
  const communitySettings = {
    settings,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
    updateSettings: jest.fn(),
    isUpdating: false,
    uploadLogo: jest.fn(),
    isUploadingLogo: false,
    archiveCommunity: jest.fn(),
  };
  const groupTypes = {
    groupTypes: [],
    isLoading: false,
    refetch: jest.fn(),
    updateGroupType: jest.fn(),
    isUpdating: false,
    createGroupType: jest.fn(),
    isCreating: false,
  };
  return {
    useCommunitySettings: () => communitySettings,
    useGroupTypes: () => groupTypes,
  };
});

jest.mock("../../../integrations/hooks/useIntegrations", () => {
  const integrations = { data: [], isLoading: false, refetch: jest.fn() };
  return { useAvailableIntegrations: () => integrations };
});

jest.mock("../../../explore/constants", () => ({
  getGroupTypeColor: () => "#25D366",
}));

jest.mock("@providers/AuthProvider", () => {
  const auth = {
    community: { id: "community-1" },
    token: "token-1",
    user: { is_primary_admin: false },
    exitToCommunitySelection: jest.fn(),
  };
  return { useAuth: () => auth };
});

jest.mock("@hooks/useCommunityTheme", () => ({
  useCommunityTheme: () => ({ primaryColor: "#25D366" }),
}));

jest.mock("@hooks/useTheme", () => ({
  useTheme: () => ({
    colors: {
      text: "#000",
      textSecondary: "#555",
      textTertiary: "#999",
      surface: "#fff",
      surfaceSecondary: "#eee",
      background: "#fff",
      border: "#ccc",
      error: "#FF3B30",
      success: "#34C759",
      warning: "#FF9500",
      inputBackground: "#fff",
      inputBorder: "#ccc",
      inputPlaceholder: "#999",
    },
    isDark: false,
  }),
}));

describe("SettingsContent — leaves the (user) settings modal before pushing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCanDismiss.mockReturnValue(true);
  });

  /** Asserts dismissAll ran, and ran BEFORE the push (order matters). */
  const expectDismissedThenPushed = (expected: string) => {
    expect(mockDismissAll).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith(expected);
    expect(mockDismissAll.mock.invocationCallOrder[0]).toBeLessThan(
      mockPush.mock.invocationCallOrder[0],
    );
  };

  it("dismisses before opening Finance", () => {
    const { getByText } = render(<SettingsContent />);
    fireEvent.press(getByText("Finance"));
    expectDismissedThenPushed("/finance-setup");
  });

  // Card provider and Financial controls are sections of the Finance home now,
  // not rows here — the home is their parent. Their routes still exist for
  // deep links; this asserts Settings has stopped duplicating them.
  it("no longer lists the finance sub-surfaces beside it", () => {
    const { queryByText } = render(<SettingsContent />);
    expect(queryByText("Card provider")).toBeNull();
    expect(queryByText("Financial controls")).toBeNull();
  });

  it("keeps in-(user) destinations a plain push", () => {
    const { getByText } = render(<SettingsContent />);
    fireEvent.press(getByText("Community-Wide Events"));
    expect(mockPush).toHaveBeenCalledWith("/(user)/admin/community-wide-events");
    expect(mockDismissAll).not.toHaveBeenCalled();
  });

  it("does not call dismissAll in the legacy shell, where there is no modal", () => {
    // `/(tabs)/admin` renders this same component with nothing to dismiss.
    mockCanDismiss.mockReturnValue(false);
    const { getByText } = render(<SettingsContent />);
    fireEvent.press(getByText("Finance"));
    expect(mockDismissAll).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith("/finance-setup");
  });
});
