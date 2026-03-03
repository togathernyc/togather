import { isGroupMember } from "../isGroupMember";
import { Group, GroupMember } from "../../types";

describe("isGroupMember", () => {
  const mockUser: GroupMember = { id: "user_1", first_name: "John", last_name: "Doe" };
  const mockOtherUser: GroupMember = { id: "user_2", first_name: "Jane", last_name: "Smith" };

  const mockGroup: Group = {
    _id: "group_1",
    id: 1,
    title: "Test Group",
    type: 1,
    members: [mockUser, mockOtherUser],
  };

  it("returns true when user is a member", () => {
    expect(isGroupMember(mockGroup, "user_1")).toBe(true);
  });

  it("returns false when user is not a member", () => {
    expect(isGroupMember(mockGroup, "user_999")).toBe(false);
  });

  it("returns false when group is null", () => {
    expect(isGroupMember(null, "user_1")).toBe(false);
  });

  it("returns false when group is undefined", () => {
    expect(isGroupMember(undefined, "user_1")).toBe(false);
  });

  it("returns false when userId is null", () => {
    expect(isGroupMember(mockGroup, null)).toBe(false);
  });

  it("returns false when userId is undefined", () => {
    expect(isGroupMember(mockGroup, undefined)).toBe(false);
  });

  it("returns false when members array is empty", () => {
    const groupWithoutMembers = { ...mockGroup, members: [] };
    expect(isGroupMember(groupWithoutMembers, "user_1")).toBe(false);
  });

  it("returns false when members array is undefined", () => {
    const groupWithoutMembers = { ...mockGroup, members: undefined };
    expect(isGroupMember(groupWithoutMembers, "user_1")).toBe(false);
  });

  it("handles members with different id types", () => {
    const groupWithStringIds = {
      ...mockGroup,
      members: [{ ...mockUser, id: "1" as any }, mockOtherUser],
    };
    // Should still work with number comparison
    expect(isGroupMember(groupWithStringIds, 1)).toBe(false);
  });

  // New tests for user_request_status field
  it("returns true when user_request_status is 'accepted'", () => {
    const groupWithAcceptedStatus = {
      ...mockGroup,
      user_request_status: "accepted" as const,
      members: [], // Even with empty members array, should return true
    };
    expect(isGroupMember(groupWithAcceptedStatus, 1)).toBe(true);
  });

  it("returns false when user_request_status is 'pending'", () => {
    const groupWithPendingStatus = {
      ...mockGroup,
      user_request_status: "pending" as const,
      members: [],
    };
    expect(isGroupMember(groupWithPendingStatus, 1)).toBe(false);
  });

  it("returns false when user_request_status is 'declined'", () => {
    const groupWithDeclinedStatus = {
      ...mockGroup,
      user_request_status: "declined" as const,
      members: [],
    };
    expect(isGroupMember(groupWithDeclinedStatus, 1)).toBe(false);
  });

  // New tests for user_role field
  it("returns true when user_role is set", () => {
    const groupWithRole = {
      ...mockGroup,
      user_role: "member" as const,
      members: [], // Even with empty members array, should return true
    };
    expect(isGroupMember(groupWithRole, 1)).toBe(true);
  });

  it("returns false when user_role is null", () => {
    const groupWithNullRole = {
      ...mockGroup,
      user_role: null,
      members: [],
    };
    expect(isGroupMember(groupWithNullRole, 1)).toBe(false);
  });

  // Test priority: user_request_status takes precedence
  it("returns true when user_request_status is 'accepted' even if not in members array", () => {
    const groupWithAcceptedStatus = {
      ...mockGroup,
      user_request_status: "accepted" as const,
      members: [mockOtherUser], // User not in members array
    };
    expect(isGroupMember(groupWithAcceptedStatus, "user_1")).toBe(true);
  });

  // Test priority: user_role takes precedence over members array
  it("returns true when user_role is set even if not in members array", () => {
    const groupWithRole = {
      ...mockGroup,
      user_role: "leader" as const,
      members: [mockOtherUser], // User not in members array
    };
    expect(isGroupMember(groupWithRole, "user_1")).toBe(true);
  });
});

