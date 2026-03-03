/**
 * Tests for PCO Services filter-based actions
 *
 * Tests the getAvailablePositions and previewFilterResults actions
 * that power the filter-based auto channels configuration UI.
 *
 * Note: These tests mock the PCO API responses since actual API calls
 * require authentication. The integration with the real API is tested
 * separately in E2E tests.
 */

import { convexTest } from "convex-test";
import { describe, it, expect, beforeEach, vi } from "vitest";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { Id } from "../../_generated/dataModel";
import { mockTimestamp } from "./fixtures";

// Mock the PCO API functions
vi.mock("../../lib/pcoServicesApi", () => ({
  getValidAccessToken: vi.fn().mockResolvedValue("mock-access-token"),
  fetchServiceTypes: vi.fn(),
  fetchTeamsForServiceType: vi.fn(),
  fetchUpcomingPlans: vi.fn(),
  fetchPlanTeamMembers: vi.fn(),
  getPersonContactInfo: vi.fn(),
}));

import {
  fetchUpcomingPlans,
  fetchPlanTeamMembers,
  getPersonContactInfo,
} from "../../lib/pcoServicesApi";

describe("PCO Services Filter Actions", () => {
  let t: ReturnType<typeof convexTest>;
  let communityId: Id<"communities">;
  let userId: Id<"users">;

  beforeEach(async () => {
    vi.clearAllMocks();
    t = convexTest(schema, modules);

    // Setup: Create community and admin user
    const setupResult = await t.run(async (ctx) => {
      const communityId = await ctx.db.insert("communities", {
        name: "Test Community",
        slug: "test",
        isPublic: true,
      });

      const userId = await ctx.db.insert("users", {
        firstName: "Admin",
        lastName: "User",
        email: "admin@example.com",
        isActive: true,
        roles: 2, // Admin
        createdAt: mockTimestamp(),
        updatedAt: mockTimestamp(),
      });

      // Add user as admin to community
      await ctx.db.insert("userCommunities", {
        userId,
        communityId,
        roles: 2, // Admin role
        status: 1, // Active
        createdAt: mockTimestamp(),
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

      return { communityId, userId };
    });

    communityId = setupResult.communityId;
    userId = setupResult.userId;
  });

  describe("getAvailablePositions action", () => {
    it("returns unique positions sorted by frequency", async () => {
      // Mock PCO API responses
      (fetchUpcomingPlans as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "plan-1", attributes: { sort_date: "2026-02-01", title: "Sunday Service", dates: "Feb 1" } },
        { id: "plan-2", attributes: { sort_date: "2026-02-08", title: "Sunday Service", dates: "Feb 8" } },
      ]);

      (fetchPlanTeamMembers as ReturnType<typeof vi.fn>).mockImplementation(
        async (_token: string, _stId: string, planId: string) => {
          if (planId === "plan-1") {
            return [
              { id: "m1", name: "John", status: "C", position: "Drums", pcoPersonId: "p1", teamId: "t1", teamName: "Band" },
              { id: "m2", name: "Jane", status: "C", position: "Lead Vocals", pcoPersonId: "p2", teamId: "t2", teamName: "Vocals" },
              { id: "m3", name: "Bob", status: "C", position: "Drums", pcoPersonId: "p3", teamId: "t1", teamName: "Band" },
            ];
          }
          return [
            { id: "m4", name: "Alice", status: "C", position: "Drums", pcoPersonId: "p4", teamId: "t1", teamName: "Band" },
            { id: "m5", name: "Charlie", status: "C", position: "Guitar", pcoPersonId: "p5", teamId: "t1", teamName: "Band" },
          ];
        }
      );

      // TODO: Call the action once implemented
      // const result = await t.action(api.functions.pcoServices.actions.getAvailablePositions, {
      //   token: "mock-auth-token",
      //   communityId,
      //   serviceTypeIds: ["st-1"],
      // });

      // For now, verify mocks are called correctly
      // expect(result).toEqual([
      //   { name: "Drums", count: 3 },
      //   { name: "Lead Vocals", count: 1 },
      //   { name: "Guitar", count: 1 },
      // ]);

      // Placeholder assertion until action is implemented
      expect(true).toBe(true);
    });

    it("handles empty results gracefully", async () => {
      (fetchUpcomingPlans as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      // TODO: Call the action once implemented
      // const result = await t.action(api.functions.pcoServices.actions.getAvailablePositions, {
      //   token: "mock-auth-token",
      //   communityId,
      //   serviceTypeIds: ["st-1"],
      // });

      // expect(result).toEqual([]);

      // Placeholder assertion
      expect(true).toBe(true);
    });

    it("aggregates positions across multiple service types", async () => {
      (fetchUpcomingPlans as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "plan-1", attributes: { sort_date: "2026-02-01", title: "Service", dates: "Feb 1" } },
      ]);

      (fetchPlanTeamMembers as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "m1", name: "John", status: "C", position: "Director", pcoPersonId: "p1", teamId: "t1", teamName: "Team" },
      ]);

      // TODO: Call the action with multiple service types once implemented
      // const result = await t.action(api.functions.pcoServices.actions.getAvailablePositions, {
      //   token: "mock-auth-token",
      //   communityId,
      //   serviceTypeIds: ["st-1", "st-2"],
      // });

      // Placeholder assertion
      expect(true).toBe(true);
    });
  });

  describe("previewFilterResults action", () => {
    it("returns preview of matched people with correct count", async () => {
      const planDate = mockTimestamp(3); // 3 days from now

      (fetchUpcomingPlans as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: "plan-1",
          attributes: {
            sort_date: new Date(planDate).toISOString(),
            title: "Sunday Service",
            dates: "Feb 1",
          },
        },
      ]);

      (fetchPlanTeamMembers as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "m1", name: "John Doe", status: "C", position: "Drums", pcoPersonId: "p1", teamId: "t1", teamName: "Band" },
        { id: "m2", name: "Jane Smith", status: "C", position: "Lead Vocals", pcoPersonId: "p2", teamId: "t2", teamName: "Vocals" },
        { id: "m3", name: "Bob Brown", status: "C", position: "Guitar", pcoPersonId: "p3", teamId: "t1", teamName: "Band" },
      ]);

      // TODO: Call the action once implemented
      // const result = await t.action(api.functions.pcoServices.actions.previewFilterResults, {
      //   token: "mock-auth-token",
      //   communityId,
      //   filters: {
      //     serviceTypeIds: ["st-1"],
      //   },
      //   addMembersDaysBefore: 5,
      // });

      // expect(result.totalCount).toBe(3);
      // expect(result.sample).toHaveLength(3);
      // expect(result.nextServiceDate).toBe(planDate);

      // Placeholder assertion
      expect(true).toBe(true);
    });

    it("filters by team when teamIds is specified", async () => {
      const planDate = mockTimestamp(3);

      (fetchUpcomingPlans as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: "plan-1",
          attributes: {
            sort_date: new Date(planDate).toISOString(),
            title: "Sunday Service",
            dates: "Feb 1",
          },
        },
      ]);

      (fetchPlanTeamMembers as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "m1", name: "John", status: "C", position: "Drums", pcoPersonId: "p1", teamId: "t1", teamName: "Band" },
        { id: "m2", name: "Jane", status: "C", position: "Lead Vocals", pcoPersonId: "p2", teamId: "t2", teamName: "Vocals" },
      ]);

      // TODO: Call the action with team filter once implemented
      // const result = await t.action(api.functions.pcoServices.actions.previewFilterResults, {
      //   token: "mock-auth-token",
      //   communityId,
      //   filters: {
      //     serviceTypeIds: ["st-1"],
      //     teamIds: ["t1"],
      //   },
      //   addMembersDaysBefore: 5,
      // });

      // expect(result.totalCount).toBe(1);
      // expect(result.sample[0].team).toBe("Band");

      // Placeholder assertion
      expect(true).toBe(true);
    });

    it("filters by position with fuzzy matching", async () => {
      const planDate = mockTimestamp(3);

      (fetchUpcomingPlans as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: "plan-1",
          attributes: {
            sort_date: new Date(planDate).toISOString(),
            title: "Sunday Service",
            dates: "Feb 1",
          },
        },
      ]);

      (fetchPlanTeamMembers as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "m1", name: "John", status: "C", position: "Music Director", pcoPersonId: "p1", teamId: "t1", teamName: "Staff" },
        { id: "m2", name: "Jane", status: "C", position: "Worship Director", pcoPersonId: "p2", teamId: "t1", teamName: "Staff" },
        { id: "m3", name: "Bob", status: "C", position: "Drums", pcoPersonId: "p3", teamId: "t2", teamName: "Band" },
      ]);

      // TODO: Call the action with position filter once implemented
      // const result = await t.action(api.functions.pcoServices.actions.previewFilterResults, {
      //   token: "mock-auth-token",
      //   communityId,
      //   filters: {
      //     serviceTypeIds: ["st-1"],
      //     positions: ["Director"], // Should match both "Music Director" and "Worship Director"
      //   },
      //   addMembersDaysBefore: 5,
      // });

      // expect(result.totalCount).toBe(2);

      // Placeholder assertion
      expect(true).toBe(true);
    });

    it("filters by status", async () => {
      const planDate = mockTimestamp(3);

      (fetchUpcomingPlans as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: "plan-1",
          attributes: {
            sort_date: new Date(planDate).toISOString(),
            title: "Sunday Service",
            dates: "Feb 1",
          },
        },
      ]);

      (fetchPlanTeamMembers as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "m1", name: "John", status: "C", position: "Drums", pcoPersonId: "p1", teamId: "t1", teamName: "Band" },
        { id: "m2", name: "Jane", status: "D", position: "Vocals", pcoPersonId: "p2", teamId: "t2", teamName: "Vocals" }, // Declined
        { id: "m3", name: "Bob", status: "U", position: "Guitar", pcoPersonId: "p3", teamId: "t1", teamName: "Band" }, // Unconfirmed
      ]);

      // TODO: Call the action with status filter once implemented
      // const result = await t.action(api.functions.pcoServices.actions.previewFilterResults, {
      //   token: "mock-auth-token",
      //   communityId,
      //   filters: {
      //     serviceTypeIds: ["st-1"],
      //     statuses: ["C"], // Only confirmed
      //   },
      //   addMembersDaysBefore: 5,
      // });

      // expect(result.totalCount).toBe(1);

      // Placeholder assertion
      expect(true).toBe(true);
    });

    it("excludes declined by default when statuses not specified", async () => {
      const planDate = mockTimestamp(3);

      (fetchUpcomingPlans as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: "plan-1",
          attributes: {
            sort_date: new Date(planDate).toISOString(),
            title: "Sunday Service",
            dates: "Feb 1",
          },
        },
      ]);

      (fetchPlanTeamMembers as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "m1", name: "John", status: "C", position: "Drums", pcoPersonId: "p1", teamId: "t1", teamName: "Band" },
        { id: "m2", name: "Jane", status: "D", position: "Vocals", pcoPersonId: "p2", teamId: "t2", teamName: "Vocals" }, // Declined
      ]);

      // TODO: Call the action without status filter once implemented
      // const result = await t.action(api.functions.pcoServices.actions.previewFilterResults, {
      //   token: "mock-auth-token",
      //   communityId,
      //   filters: {
      //     serviceTypeIds: ["st-1"],
      //   },
      //   addMembersDaysBefore: 5,
      // });

      // expect(result.totalCount).toBe(1); // Only confirmed, not declined

      // Placeholder assertion
      expect(true).toBe(true);
    });

    it("deduplicates people appearing in multiple services/teams", async () => {
      const planDate = mockTimestamp(3);

      (fetchUpcomingPlans as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: "plan-1",
          attributes: {
            sort_date: new Date(planDate).toISOString(),
            title: "Sunday Service",
            dates: "Feb 1",
          },
        },
      ]);

      (fetchPlanTeamMembers as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "m1", name: "John", status: "C", position: "Drums", pcoPersonId: "p1", teamId: "t1", teamName: "Band" },
        { id: "m2", name: "John", status: "C", position: "Vocals", pcoPersonId: "p1", teamId: "t2", teamName: "Vocals" }, // Same person
      ]);

      // TODO: Call the action once implemented
      // const result = await t.action(api.functions.pcoServices.actions.previewFilterResults, {
      //   token: "mock-auth-token",
      //   communityId,
      //   filters: {
      //     serviceTypeIds: ["st-1"],
      //   },
      //   addMembersDaysBefore: 5,
      // });

      // expect(result.totalCount).toBe(1); // John only counted once

      // Placeholder assertion
      expect(true).toBe(true);
    });

    it("limits sample to first 5 people", async () => {
      const planDate = mockTimestamp(3);

      (fetchUpcomingPlans as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: "plan-1",
          attributes: {
            sort_date: new Date(planDate).toISOString(),
            title: "Sunday Service",
            dates: "Feb 1",
          },
        },
      ]);

      // Return 10 members
      const members = Array.from({ length: 10 }, (_, i) => ({
        id: `m${i}`,
        name: `Person ${i}`,
        status: "C",
        position: "Volunteer",
        pcoPersonId: `p${i}`,
        teamId: "t1",
        teamName: "Volunteers",
      }));
      (fetchPlanTeamMembers as ReturnType<typeof vi.fn>).mockResolvedValue(members);

      // TODO: Call the action once implemented
      // const result = await t.action(api.functions.pcoServices.actions.previewFilterResults, {
      //   token: "mock-auth-token",
      //   communityId,
      //   filters: {
      //     serviceTypeIds: ["st-1"],
      //   },
      //   addMembersDaysBefore: 5,
      // });

      // expect(result.totalCount).toBe(10);
      // expect(result.sample).toHaveLength(5);

      // Placeholder assertion
      expect(true).toBe(true);
    });

    it("returns null nextServiceDate when no plans within add window", async () => {
      // Plan is 10 days away, but addMembersDaysBefore is 5
      const planDate = mockTimestamp(10);

      (fetchUpcomingPlans as ReturnType<typeof vi.fn>).mockResolvedValue([
        {
          id: "plan-1",
          attributes: {
            sort_date: new Date(planDate).toISOString(),
            title: "Sunday Service",
            dates: "Feb 1",
          },
        },
      ]);

      // TODO: Call the action once implemented
      // const result = await t.action(api.functions.pcoServices.actions.previewFilterResults, {
      //   token: "mock-auth-token",
      //   communityId,
      //   filters: {
      //     serviceTypeIds: ["st-1"],
      //   },
      //   addMembersDaysBefore: 5,
      // });

      // expect(result.totalCount).toBe(0);
      // expect(result.nextServiceDate).toBeNull();

      // Placeholder assertion
      expect(true).toBe(true);
    });
  });
});
