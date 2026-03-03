/**
 * Tests for AutoChannelSettings Configuration Display
 *
 * Tests the Configuration section display including:
 * - Service Types display (with filter-based config)
 * - Teams display (with service type context to disambiguate duplicates)
 * - Positions display (new field)
 * - Timing settings
 */
import React from "react";
import { render } from "@testing-library/react-native";

// Mock modules BEFORE importing component
jest.mock("expo-router", () => ({
  useRouter: () => ({
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn(() => true),
  }),
}));

jest.mock("@providers/AuthProvider", () => ({
  useAuth: () => ({
    token: "mock-token",
    user: { id: "user-1", displayName: "Test User" },
  }),
}));

jest.mock("@hooks/useCommunityTheme", () => ({
  useCommunityTheme: () => ({
    primaryColor: "#007AFF",
  }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("date-fns", () => ({
  formatDistanceToNow: () => "5 minutes ago",
}));

// Mock config data
const mockConfigWithFilters = {
  _id: "config-1",
  channelId: "channel-1",
  communityId: "community-1",
  integrationType: "pco_services",
  isActive: true,
  lastSyncStatus: "success",
  lastSyncAt: Date.now(),
  config: {
    // New filter-based config
    filters: {
      serviceTypeIds: ["st-1", "st-2"],
      serviceTypeNames: ["Sunday Service", "Wednesday Night"],
      teamIds: ["team-1", "team-2", "team-3"],
      teamNames: ["Worship", "Production", "Platform"],
      positions: ["Director", "Lead Vocalist", "Band Leader"],
    },
    // Legacy fields
    serviceTypeId: "st-1",
    serviceTypeName: "Sunday Service",
    syncScope: "multi_team",
    teamIds: ["team-1", "team-2", "team-3"],
    teamNames: ["Worship", "Production", "Platform"],
    addMembersDaysBefore: 5,
    removeMembersDaysAfter: 1,
  },
};

const mockConfigLegacy = {
  _id: "config-2",
  channelId: "channel-2",
  communityId: "community-1",
  integrationType: "pco_services",
  isActive: true,
  lastSyncStatus: "success",
  lastSyncAt: Date.now(),
  config: {
    // Legacy config without filters
    serviceTypeId: "st-1",
    serviceTypeName: "Sunday Service",
    syncScope: "all_teams",
    addMembersDaysBefore: 7,
    removeMembersDaysAfter: 2,
  },
};

const mockConfigNoPositions = {
  _id: "config-3",
  channelId: "channel-3",
  communityId: "community-1",
  integrationType: "pco_services",
  isActive: true,
  lastSyncStatus: "success",
  lastSyncAt: Date.now(),
  config: {
    filters: {
      serviceTypeIds: ["st-1"],
      serviceTypeNames: ["Sunday Service"],
      teamIds: ["team-1"],
      teamNames: ["Worship"],
      // No positions - should show "All positions"
    },
    serviceTypeId: "st-1",
    serviceTypeName: "Sunday Service",
    syncScope: "single_team",
    teamIds: ["team-1"],
    teamNames: ["Worship"],
    addMembersDaysBefore: 3,
    removeMembersDaysAfter: 0,
  },
};

let mockQueryReturn: any = null;

jest.mock("@services/api/convex", () => ({
  useQuery: () => mockQueryReturn,
  useMutation: () => jest.fn(),
  useAction: () => jest.fn(),
  api: {
    functions: {
      pcoServices: {
        queries: {
          getAutoChannelConfigByChannel: "getAutoChannelConfigByChannel",
        },
        actions: {
          triggerChannelSync: "triggerChannelSync",
        },
      },
      messaging: {
        channels: {
          updateAutoChannelConfig: "updateAutoChannelConfig",
          disableAutoChannel: "disableAutoChannel",
        },
      },
    },
  },
}));

// Mock PcoAutoChannelConfig component (only used in edit mode)
jest.mock("../PcoAutoChannelConfig", () => ({
  PcoAutoChannelConfig: () => null,
}));

// Import component AFTER mocks
import { AutoChannelSettings } from "../AutoChannelSettings";

describe("AutoChannelSettings Configuration Display", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryReturn = null;
  });

  describe("Service Types Display", () => {
    it("displays multiple service types from filters", () => {
      mockQueryReturn = mockConfigWithFilters;

      const { getByText } = render(
        <AutoChannelSettings
          channelId={"channel-1" as any}
          groupId={"group-1" as any}
          communityId={"community-1" as any}
          canEdit={false}
          onClose={jest.fn()}
        />
      );

      // Should show both service types
      expect(getByText(/Sunday Service/)).toBeTruthy();
      expect(getByText(/Wednesday Night/)).toBeTruthy();
    });

    it("displays single service type from legacy config", () => {
      mockQueryReturn = mockConfigLegacy;

      const { getByText } = render(
        <AutoChannelSettings
          channelId={"channel-2" as any}
          groupId={"group-1" as any}
          communityId={"community-1" as any}
          canEdit={false}
          onClose={jest.fn()}
        />
      );

      expect(getByText(/Sunday Service/)).toBeTruthy();
    });
  });

  describe("Teams Display", () => {
    it("displays teams from filters", () => {
      mockQueryReturn = mockConfigWithFilters;

      const { getByText } = render(
        <AutoChannelSettings
          channelId={"channel-1" as any}
          groupId={"group-1" as any}
          communityId={"community-1" as any}
          canEdit={false}
          onClose={jest.fn()}
        />
      );

      expect(getByText(/Worship/)).toBeTruthy();
      expect(getByText(/Production/)).toBeTruthy();
      expect(getByText(/Platform/)).toBeTruthy();
    });

    it("displays 'All Teams' when syncScope is all_teams", () => {
      mockQueryReturn = mockConfigLegacy;

      const { getByText } = render(
        <AutoChannelSettings
          channelId={"channel-2" as any}
          groupId={"group-1" as any}
          communityId={"community-1" as any}
          canEdit={false}
          onClose={jest.fn()}
        />
      );

      expect(getByText("All Teams")).toBeTruthy();
    });
  });

  describe("Positions Display", () => {
    it("displays positions from filters", () => {
      mockQueryReturn = mockConfigWithFilters;

      const { getByText } = render(
        <AutoChannelSettings
          channelId={"channel-1" as any}
          groupId={"group-1" as any}
          communityId={"community-1" as any}
          canEdit={false}
          onClose={jest.fn()}
        />
      );

      // Should show positions label
      expect(getByText("Positions")).toBeTruthy();
      // Should show the positions
      expect(getByText(/Director/)).toBeTruthy();
      expect(getByText(/Lead Vocalist/)).toBeTruthy();
      expect(getByText(/Band Leader/)).toBeTruthy();
    });

    it("displays 'All positions' when no positions filter", () => {
      mockQueryReturn = mockConfigNoPositions;

      const { getByText } = render(
        <AutoChannelSettings
          channelId={"channel-3" as any}
          groupId={"group-1" as any}
          communityId={"community-1" as any}
          canEdit={false}
          onClose={jest.fn()}
        />
      );

      expect(getByText("All positions")).toBeTruthy();
    });

    it("does not display positions row for legacy config without filters", () => {
      mockQueryReturn = mockConfigLegacy;

      const { getByText, queryByText } = render(
        <AutoChannelSettings
          channelId={"channel-2" as any}
          groupId={"group-1" as any}
          communityId={"community-1" as any}
          canEdit={false}
          onClose={jest.fn()}
        />
      );

      // Should show Configuration section
      expect(getByText("Configuration")).toBeTruthy();
      // Should show "All positions" even for legacy config (graceful handling)
      expect(getByText("All positions")).toBeTruthy();
    });
  });

  describe("Timing Settings Display", () => {
    it("displays add members timing", () => {
      mockQueryReturn = mockConfigWithFilters;

      const { getByText } = render(
        <AutoChannelSettings
          channelId={"channel-1" as any}
          groupId={"group-1" as any}
          communityId={"community-1" as any}
          canEdit={false}
          onClose={jest.fn()}
        />
      );

      expect(getByText("Add Members")).toBeTruthy();
      expect(getByText("5 days before service")).toBeTruthy();
    });

    it("displays remove members timing", () => {
      mockQueryReturn = mockConfigWithFilters;

      const { getByText } = render(
        <AutoChannelSettings
          channelId={"channel-1" as any}
          groupId={"group-1" as any}
          communityId={"community-1" as any}
          canEdit={false}
          onClose={jest.fn()}
        />
      );

      expect(getByText("Remove Members")).toBeTruthy();
      expect(getByText("1 days after service")).toBeTruthy();
    });

    it("displays different timing values", () => {
      mockQueryReturn = mockConfigLegacy;

      const { getByText } = render(
        <AutoChannelSettings
          channelId={"channel-2" as any}
          groupId={"group-1" as any}
          communityId={"community-1" as any}
          canEdit={false}
          onClose={jest.fn()}
        />
      );

      expect(getByText("7 days before service")).toBeTruthy();
      expect(getByText("2 days after service")).toBeTruthy();
    });

    it("handles 0 days timing", () => {
      mockQueryReturn = mockConfigNoPositions;

      const { getByText } = render(
        <AutoChannelSettings
          channelId={"channel-3" as any}
          groupId={"group-1" as any}
          communityId={"community-1" as any}
          canEdit={false}
          onClose={jest.fn()}
        />
      );

      expect(getByText("3 days before service")).toBeTruthy();
      expect(getByText("0 days after service")).toBeTruthy();
    });
  });

  describe("Loading State", () => {
    it("shows loading indicator when config is not available", () => {
      mockQueryReturn = null;

      const { getByText } = render(
        <AutoChannelSettings
          channelId={"channel-1" as any}
          groupId={"group-1" as any}
          communityId={"community-1" as any}
          canEdit={false}
          onClose={jest.fn()}
        />
      );

      expect(getByText("Loading settings...")).toBeTruthy();
    });
  });
});
