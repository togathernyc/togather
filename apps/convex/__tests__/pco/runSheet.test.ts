/**
 * Tests for PCO Run Sheet functionality
 *
 * Tests the getAvailableServiceTypes and getRunSheet actions
 * that power the Run Sheet feature for viewing PCO service plans.
 *
 * Note: These tests mock the PCO API responses since actual API calls
 * require authentication.
 */

import { convexTest } from "convex-test";
import { describe, it, expect, beforeEach, vi } from "vitest";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { api } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";
import {
  mockTimestamp,
  createMockPlan,
} from "./fixtures";

// Mutable reference for mock userId (set in beforeEach, used by auth mock)
let mockUserId: Id<"users"> | null = null;

// Mock the auth module to return our test user
vi.mock("../../lib/auth", () => ({
  requireAuth: vi.fn().mockImplementation(async () => {
    if (!mockUserId) throw new Error("Mock userId not set");
    return mockUserId;
  }),
  getOptionalAuth: vi.fn().mockImplementation(async () => mockUserId),
  verifyAccessToken: vi.fn().mockResolvedValue({ sub: "test-user" }),
}));

// Mock the PCO API functions
vi.mock("../../lib/pcoServicesApi", () => ({
  getValidAccessToken: vi.fn().mockResolvedValue("mock-access-token"),
  fetchServiceTypes: vi.fn(),
  fetchUpcomingPlans: vi.fn(),
  fetchPlanItems: vi.fn(),
  fetchPlanTeamMembers: vi.fn(),
  fetchPlanAllAttachments: vi.fn().mockResolvedValue({ data: [] }),
  fetchPlanTimes: vi.fn().mockResolvedValue([]),
}));

import {
  fetchServiceTypes,
  fetchUpcomingPlans,
  fetchPlanItems,
  fetchPlanTeamMembers,
  fetchPlanAllAttachments,
  fetchPlanTimes,
} from "../../lib/pcoServicesApi";

// Helper to create mock service types
function createMockServiceTypes() {
  return [
    {
      id: "manhattan-service",
      type: "ServiceType",
      attributes: { name: "MANHATTAN" },
    },
    {
      id: "brooklyn-service",
      type: "ServiceType",
      attributes: { name: "BROOKLYN" },
    },
  ];
}

// Helper to create mock plan items
function createMockPlanItems() {
  return {
    data: [
      {
        id: "item-1",
        type: "Item",
        attributes: {
          title: "Welcome",
          description: null,
          item_type: "header",
          length: null,
          service_position: "pre-service",
          sequence: 1,
          key_name: null,
        },
        relationships: {},
      },
      {
        id: "item-2",
        type: "Item",
        attributes: {
          title: "Goodness of God",
          description: null,
          item_type: "song",
          length: 300,
          service_position: "worship",
          sequence: 2,
          key_name: null, // Uses arrangement's chord_chart_key when null
        },
        relationships: {
          song: { data: { id: "song-1", type: "Song" } },
          arrangement: { data: { id: "arr-1", type: "Arrangement" } },
          item_notes: { data: [] },
          item_times: { data: [] },
        },
      },
    ],
    included: [
      {
        id: "song-1",
        type: "Song",
        attributes: {
          title: "Goodness of God",
          ccli_number: "7117726",
          author: "Ben Fielding, Brian Johnson",
        },
      },
      {
        id: "arr-1",
        type: "Arrangement",
        attributes: {
          name: "Radio Version",
          bpm: 68,
          length: 300,
          meter: "4/4",
          chord_chart_key: "G",
        },
      },
    ],
  };
}

describe("PCO Run Sheet", () => {
  let t: ReturnType<typeof convexTest>;
  let communityId: Id<"communities">;
  let groupId: Id<"groups">;
  let userId: Id<"users">;

  beforeEach(async () => {
    vi.clearAllMocks();
    t = convexTest(schema, modules);

    // Setup: Create community, group, user, and PCO integration
    const setupResult = await t.run(async (ctx) => {
      const communityId = await ctx.db.insert("communities", {
        name: "Test Church",
        slug: "test-church",
        isPublic: true,
      });

      const groupTypeId = await ctx.db.insert("groupTypes", {
        communityId,
        name: "Worship Team",
        slug: "worship-team",
        isActive: true,
        createdAt: mockTimestamp(),
        displayOrder: 0,
      });

      const groupId = await ctx.db.insert("groups", {
        communityId,
        groupTypeId,
        name: "Sunday Worship",
        isArchived: false,
        createdAt: mockTimestamp(),
        updatedAt: mockTimestamp(),
      });

      const userId = await ctx.db.insert("users", {
        firstName: "Admin",
        lastName: "User",
        email: "admin@example.com",
        isActive: true,
        roles: 2,
        createdAt: mockTimestamp(),
        updatedAt: mockTimestamp(),
      });

      // Add user as admin to community
      await ctx.db.insert("userCommunities", {
        userId,
        communityId,
        roles: 2,
        status: 1,
        createdAt: mockTimestamp(),
      });

      // Add user as leader to group
      await ctx.db.insert("groupMembers", {
        groupId,
        userId,
        role: "leader",
        joinedAt: mockTimestamp(),
        notificationsEnabled: true,
      });

      // Setup PCO integration
      await ctx.db.insert("communityIntegrations", {
        communityId,
        integrationType: "planning_center",
        status: "connected",
        credentials: {
          access_token: "mock-token",
          refresh_token: "mock-refresh",
          token_type: "Bearer",
          expires_in: 3600,
          created_at: Math.floor(Date.now() / 1000),
        },
        config: {},
        createdAt: mockTimestamp(),
        updatedAt: mockTimestamp(),
      });

      // Create a channel with PCO auto-channel config (MANHATTAN)
      const manhattanChannelId = await ctx.db.insert("chatChannels", {
        groupId,
        name: "Manhattan Team",
        slug: "manhattan-team",
        channelType: "custom",
        createdById: userId,
        createdAt: mockTimestamp(),
        updatedAt: mockTimestamp(),
        isArchived: false,
        memberCount: 0,
      });

      await ctx.db.insert("autoChannelConfigs", {
        communityId,
        channelId: manhattanChannelId,
        integrationType: "pco_services",
        config: {
          filters: {
            serviceTypeIds: ["manhattan-service"],
            serviceTypeNames: ["MANHATTAN"],
          },
          addMembersDaysBefore: 5,
          removeMembersDaysAfter: 1,
        },
        isActive: true,
        createdAt: mockTimestamp(),
        updatedAt: mockTimestamp(),
      });

      // Create another channel with PCO auto-channel config (BROOKLYN)
      const brooklynChannelId = await ctx.db.insert("chatChannels", {
        groupId,
        name: "Brooklyn Team",
        slug: "brooklyn-team",
        channelType: "custom",
        createdById: userId,
        createdAt: mockTimestamp(),
        updatedAt: mockTimestamp(),
        isArchived: false,
        memberCount: 0,
      });

      await ctx.db.insert("autoChannelConfigs", {
        communityId,
        channelId: brooklynChannelId,
        integrationType: "pco_services",
        config: {
          filters: {
            serviceTypeIds: ["brooklyn-service"],
            serviceTypeNames: ["BROOKLYN"],
          },
          addMembersDaysBefore: 5,
          removeMembersDaysAfter: 1,
        },
        isActive: true,
        createdAt: mockTimestamp(),
        updatedAt: mockTimestamp(),
      });

      return { communityId, groupId, userId };
    });

    communityId = setupResult.communityId;
    groupId = setupResult.groupId;
    userId = setupResult.userId;
    // Set the mock userId for auth
    mockUserId = userId;
  });

  describe("getAvailableServiceTypes", () => {
    it("should return all configured service types for a group", async () => {
      // Mock PCO API responses
      (fetchServiceTypes as any).mockResolvedValue(createMockServiceTypes());
      // Mock upcoming plans (returns empty array by default)
      (fetchUpcomingPlans as any).mockResolvedValue([]);

      const result = await t.action(
        api.functions.pcoServices.runSheet.getAvailableServiceTypes,
        {
          token: "mock-token",
          groupId,
        }
      );

      expect(result).toHaveLength(2);
      expect(result).toContainEqual(
        expect.objectContaining({
          id: "manhattan-service",
          name: "MANHATTAN",
        })
      );
      expect(result).toContainEqual(
        expect.objectContaining({
          id: "brooklyn-service",
          name: "BROOKLYN",
        })
      );
    });

    it("should include upcoming plan info for each service type", async () => {
      (fetchServiceTypes as any).mockResolvedValue(createMockServiceTypes());
      (fetchUpcomingPlans as any).mockImplementation((token, serviceTypeId) => {
        if (serviceTypeId === "manhattan-service") {
          return Promise.resolve([
            createMockPlan({ id: "manhattan-plan-1", offsetDays: 3 }),
            createMockPlan({ id: "manhattan-plan-2", offsetDays: 10 }),
          ]);
        }
        return Promise.resolve([
          createMockPlan({ id: "brooklyn-plan-1", offsetDays: 3 }),
        ]);
      });

      const result = await t.action(
        api.functions.pcoServices.runSheet.getAvailableServiceTypes,
        {
          token: "mock-token",
          groupId,
        }
      );

      // Manhattan should have 2 upcoming plans
      const manhattan = result.find((s: any) => s.id === "manhattan-service");
      expect(manhattan.upcomingPlans).toHaveLength(2);

      // Brooklyn should have 1 upcoming plan
      const brooklyn = result.find((s: any) => s.id === "brooklyn-service");
      expect(brooklyn.upcomingPlans).toHaveLength(1);
    });
  });

  describe("getRunSheet", () => {
    beforeEach(() => {
      // Default mocks
      (fetchServiceTypes as any).mockResolvedValue(createMockServiceTypes());
      (fetchUpcomingPlans as any).mockResolvedValue([
        createMockPlan({ offsetDays: 3 }),
      ]);
      (fetchPlanItems as any).mockResolvedValue(createMockPlanItems());
      (fetchPlanTeamMembers as any).mockResolvedValue([
        {
          id: "member-1",
          name: "John Doe",
          status: "C",
          position: "Worship Leader",
          pcoPersonId: "person-1",
          teamId: "team-1",
          teamName: "Worship",
        },
      ]);
    });

    it("should fetch run sheet for specific service type", async () => {
      const result = await t.action(
        api.functions.pcoServices.runSheet.getRunSheet,
        {
          token: "mock-token",
          groupId,
          serviceTypeId: "manhattan-service",
        }
      );

      expect(result).not.toBeNull();
      expect(result.serviceTypeName).toBe("MANHATTAN");
      expect(result.items).toHaveLength(2);
    });

    it("should fetch run sheet for specific plan", async () => {
      (fetchUpcomingPlans as any).mockResolvedValue([
        createMockPlan({ id: "plan-1", offsetDays: 3 }),
        createMockPlan({ id: "plan-2", offsetDays: 10 }),
      ]);

      const result = await t.action(
        api.functions.pcoServices.runSheet.getRunSheet,
        {
          token: "mock-token",
          groupId,
          serviceTypeId: "manhattan-service",
          planId: "plan-2",
        }
      );

      expect(result.planId).toBe("plan-2");
    });

    it("should return compact song info", async () => {
      const result = await t.action(
        api.functions.pcoServices.runSheet.getRunSheet,
        {
          token: "mock-token",
          groupId,
          serviceTypeId: "manhattan-service",
        }
      );

      const song = result.items.find((i: any) => i.type === "song");
      expect(song).toBeDefined();
      expect(song.title).toBe("Goodness of God");
      expect(song.songDetails.key).toBe("G");
      expect(song.songDetails.arrangement).toBe("Radio Version");
    });

    it("should include team members", async () => {
      const result = await t.action(
        api.functions.pcoServices.runSheet.getRunSheet,
        {
          token: "mock-token",
          groupId,
          serviceTypeId: "manhattan-service",
        }
      );

      expect(result.teamMembers).toHaveLength(1);
      expect(result.teamMembers[0]).toEqual({
        name: "John Doe",
        position: "Worship Leader",
        team: "Worship",
        status: "C",
      });
    });

    it("should return null if no upcoming plans", async () => {
      (fetchUpcomingPlans as any).mockResolvedValue([]);

      const result = await t.action(
        api.functions.pcoServices.runSheet.getRunSheet,
        {
          token: "mock-token",
          groupId,
          serviceTypeId: "manhattan-service",
        }
      );

      expect(result).toBeNull();
    });
  });

  describe("runSheetConfig", () => {
    it("should save default service type filter for group", async () => {
      await t.mutation(
        api.functions.groups.mutations.updateRunSheetConfig,
        {
          token: "mock-token",
          groupId,
          runSheetConfig: {
            defaultServiceTypeIds: ["manhattan-service"],
            defaultView: "compact",
          },
        }
      );

      // Verify config was saved
      const group = await t.run(async (ctx) => {
        return ctx.db.get(groupId);
      });

      expect(group?.runSheetConfig).toEqual({
        defaultServiceTypeIds: ["manhattan-service"],
        defaultView: "compact",
      });
    });

    it("should apply default filter when fetching run sheets", async () => {
      // First save config
      await t.mutation(
        api.functions.groups.mutations.updateRunSheetConfig,
        {
          token: "mock-token",
          groupId,
          runSheetConfig: {
            defaultServiceTypeIds: ["manhattan-service"],
          },
        }
      );

      // Mock API
      (fetchServiceTypes as any).mockResolvedValue(createMockServiceTypes());
      (fetchUpcomingPlans as any).mockResolvedValue([
        createMockPlan({ offsetDays: 3 }),
      ]);
      (fetchPlanItems as any).mockResolvedValue(createMockPlanItems());
      (fetchPlanTeamMembers as any).mockResolvedValue([]);

      // Fetch without specifying serviceTypeId - should use default
      const result = await t.action(
        api.functions.pcoServices.runSheet.getRunSheet,
        {
          token: "mock-token",
          groupId,
          // No serviceTypeId - should use default from config
        }
      );

      expect(result.serviceTypeName).toBe("MANHATTAN");
    });
  });
});
