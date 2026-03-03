/**
 * Test fixtures for PCO Services integration tests
 *
 * Provides mock data for Planning Center Services API responses and
 * database documents used in testing the rotation and matching logic.
 */

import { Id } from "../../_generated/dataModel";

// Helper to create mock timestamps
export function mockTimestamp(offsetDays: number = 0): number {
  return Date.now() + offsetDays * 24 * 60 * 60 * 1000;
}

// ============================================================================
// User & Community Fixtures
// ============================================================================

export function createMockUser(overrides?: Partial<any>) {
  return {
    _id: "user1" as Id<"users">,
    firstName: "John",
    lastName: "Doe",
    email: "john.doe@example.com",
    phone: "+12025550123",
    phoneVerified: true,
    isActive: true,
    roles: 1,
    createdAt: mockTimestamp(),
    updatedAt: mockTimestamp(),
    ...overrides,
  };
}

export function createMockCommunity(overrides?: Partial<any>) {
  return {
    _id: "community1" as Id<"communities">,
    name: "Demo Community",
    slug: "demo-community",
    subdomain: "demo",
    timezone: "America/New_York",
    isPublic: true,
    createdAt: mockTimestamp(),
    updatedAt: mockTimestamp(),
    ...overrides,
  };
}

export function createMockUserCommunity(
  userId: Id<"users">,
  communityId: Id<"communities">,
  overrides?: Partial<any>
) {
  return {
    _id: "uc1" as Id<"userCommunities">,
    userId,
    communityId,
    roles: 1, // MEMBER
    status: 1,
    createdAt: mockTimestamp(),
    externalIds: {},
    ...overrides,
  };
}

export function createMockChannel(
  communityId: Id<"communities">,
  overrides?: Partial<any>
) {
  return {
    _id: "channel1" as Id<"chatChannels">,
    communityId,
    name: "Sunday Service Team",
    description: "Coordination for Sunday services",
    isPrivate: true,
    isPublic: false,
    createdAt: mockTimestamp(),
    updatedAt: mockTimestamp(),
    memberCount: 0,
    ...overrides,
  };
}

// ============================================================================
// Auto Channel Config Fixtures
// ============================================================================

export function createMockAutoChannelConfig(
  communityId: Id<"communities">,
  channelId: Id<"chatChannels">,
  overrides?: Partial<any>
) {
  return {
    _id: "config1" as Id<"autoChannelConfigs">,
    communityId,
    channelId,
    integrationType: "pco_services",
    config: {
      serviceTypeId: "service-type-123",
      serviceTypeName: "Sunday Service",
      syncScope: "all_teams",
      addMembersDaysBefore: 5,
      removeMembersDaysAfter: 1,
    },
    isActive: true,
    createdAt: mockTimestamp(),
    updatedAt: mockTimestamp(),
    lastSyncAt: mockTimestamp(-1),
    lastSyncStatus: "success",
    ...overrides,
  };
}

// ============================================================================
// Planning Center Services API Response Fixtures
// ============================================================================

export function createMockServiceType(overrides?: Partial<any>) {
  return {
    id: "service-type-123",
    name: "Sunday Service",
    ...overrides,
  };
}

export function createMockTeam(overrides?: Partial<any>) {
  return {
    id: "team-456",
    name: "Production",
    ...overrides,
  };
}

export function createMockPlan(
  overrides?: Partial<any> & { offsetDays?: number }
) {
  const { offsetDays = 5, ...rest } = overrides || {};
  const planDate = mockTimestamp(offsetDays);

  return {
    id: "plan-789",
    type: "Plan",
    attributes: {
      title: "Sunday Worship Service",
      sort_date: new Date(planDate).toISOString(),
      dates: "February 1, 2026",
      created_at: new Date(mockTimestamp(-10)).toISOString(),
      updated_at: new Date().toISOString(),
    },
    relationships: {
      service_type: {
        data: {
          id: "service-type-123",
          type: "ServiceType",
        },
      },
    },
    ...rest,
  };
}

export function createMockTeamMember(
  personId: string = "person-1",
  status: "C" | "D" | "T" = "C",
  overrides?: Partial<any>
) {
  return {
    id: "member-101",
    type: "TeamMember",
    attributes: {
      name: "John Doe",
      status, // C = Confirmed, D = Declined, T = Tentative
      team_position_name: "Audio Operator",
      created_at: new Date(mockTimestamp(-1)).toISOString(),
      updated_at: new Date().toISOString(),
    },
    relationships: {
      person: {
        data: {
          id: personId,
          type: "Person",
        },
      },
      team: {
        data: {
          id: "team-456",
          type: "Team",
        },
      },
    },
    ...overrides,
  };
}

export function createMockPerson(
  id: string = "person-1",
  overrides?: Partial<any>
) {
  return {
    id,
    type: "Person",
    attributes: {
      first_name: "John",
      last_name: "Doe",
      email_address: "john.doe@example.com",
      phone_number: "+12025550123",
      created_at: new Date(mockTimestamp(-30)).toISOString(),
      updated_at: new Date().toISOString(),
    },
    ...overrides,
  };
}

// ============================================================================
// Chat Channel Member Fixtures
// ============================================================================

export function createMockChannelMember(
  channelId: Id<"chatChannels">,
  userId: Id<"users">,
  overrides?: Partial<any>
) {
  return {
    _id: "member-1" as Id<"chatChannelMembers">,
    channelId,
    userId,
    role: "member",
    joinedAt: mockTimestamp(),
    isMuted: false,
    syncSource: "pco_services",
    syncEventId: "plan-789",
    scheduledRemovalAt: mockTimestamp(6),
    ...overrides,
  };
}

// ============================================================================
// Test Data Scenarios
// ============================================================================

/**
 * Complete test scenario: Setup full test data with community, users, channel, and config
 */
export function createMockTestScenario() {
  const community = createMockCommunity();
  const channel = createMockChannel(community._id);
  const user1 = createMockUser({
    _id: "user1" as Id<"users">,
    firstName: "John",
    lastName: "Doe",
    email: "john.doe@example.com",
    phone: "2025550123", // Will be normalized
  });
  const user2 = createMockUser({
    _id: "user2" as Id<"users">,
    firstName: "Jane",
    lastName: "Smith",
    email: "jane.smith@example.com",
    phone: "2025550124",
  });
  const userCommunity1 = createMockUserCommunity(user1._id, community._id);
  const userCommunity2 = createMockUserCommunity(user2._id, community._id);
  const config = createMockAutoChannelConfig(community._id, channel._id);

  return {
    community,
    channel,
    users: [user1, user2],
    userCommunities: [userCommunity1, userCommunity2],
    config,
  };
}

/**
 * Complete PCO plan scenario with multiple team members
 */
export function createMockPlanWithMembers(
  planOffsetDays: number = 5,
  memberCount: number = 3
) {
  const plan = createMockPlan({ offsetDays: planOffsetDays });

  const members = Array.from({ length: memberCount }, (_, i) => {
    const personId = `person-${i + 1}`;
    return createMockTeamMember(personId, "C");
  });

  return {
    plan,
    members,
    persons: members.map((m, i) =>
      createMockPerson(`person-${i + 1}`, {
        attributes: {
          first_name: `Team Member ${i + 1}`,
          last_name: `Name ${i + 1}`,
          email_address: `member${i + 1}@example.com`,
          phone_number: `202555012${i}`,
        },
      })
    ),
  };
}
