/**
 * Tests for ChannelMemberRows shared components
 */
import React from "react";
import { render } from "@testing-library/react-native";
import { View } from "react-native";
import {
  SyncedMemberRowContent,
  UnsyncedPersonRowContent,
  getInitials,
} from "../ChannelMemberRows";
import type { ChannelMember, UnsyncedPerson } from "@/utils/channel-members";
import type { Id } from "@services/api/convex";

describe("getInitials", () => {
  it("returns first letters of first and last name", () => {
    expect(getInitials("John Doe")).toBe("JD");
  });

  it("handles single name", () => {
    expect(getInitials("Madonna")).toBe("M");
  });

  it("handles multiple names", () => {
    expect(getInitials("John Paul Jones")).toBe("JPJ".slice(0, 2));
  });

  it("returns ? for empty string", () => {
    expect(getInitials("")).toBe("?");
  });

  it("uppercases initials", () => {
    expect(getInitials("john doe")).toBe("JD");
  });
});

describe("SyncedMemberRowContent", () => {
  const mockMember: ChannelMember = {
    id: "member-1",
    userId: "user-1" as Id<"users">,
    displayName: "John Doe",
    role: "member",
  };

  const mockOwner: ChannelMember = {
    id: "owner-1",
    userId: "owner-user" as Id<"users">,
    displayName: "Owner Person",
    role: "owner",
  };

  const mockPcoMember: ChannelMember = {
    id: "pco-1",
    userId: "pco-user" as Id<"users">,
    displayName: "PCO User",
    role: "member",
    syncSource: "pco_services",
    syncMetadata: {
      teamName: "Worship Team",
      serviceTypeName: "Sunday Service",
      position: "Vocals",
    },
  };

  it("renders member name", () => {
    const { getByText } = render(
      <View>
        <SyncedMemberRowContent
          member={mockMember}
          primaryColor="#007AFF"
        />
      </View>
    );
    expect(getByText("John Doe")).toBeTruthy();
  });

  it("shows (you) badge for current user", () => {
    const { getByText } = render(
      <View>
        <SyncedMemberRowContent
          member={mockMember}
          primaryColor="#007AFF"
          isCurrentUser
        />
      </View>
    );
    expect(getByText("(you)")).toBeTruthy();
  });

  it("shows Owner badge for owner role", () => {
    const { getByText } = render(
      <View>
        <SyncedMemberRowContent
          member={mockOwner}
          primaryColor="#007AFF"
        />
      </View>
    );
    expect(getByText("Owner")).toBeTruthy();
  });

  it("shows PCO sync metadata badges", () => {
    const { getByText } = render(
      <View>
        <SyncedMemberRowContent
          member={mockPcoMember}
          primaryColor="#007AFF"
        />
      </View>
    );
    expect(getByText("Sunday Service > Worship Team")).toBeTruthy();
    expect(getByText("Vocals")).toBeTruthy();
  });

  it("renders rightContent when provided", () => {
    const { getByTestId } = render(
      <View>
        <SyncedMemberRowContent
          member={mockMember}
          primaryColor="#007AFF"
          rightContent={<View testID="right-content" />}
        />
      </View>
    );
    expect(getByTestId("right-content")).toBeTruthy();
  });

  it("renders initials when no profile photo", () => {
    const { getByText } = render(
      <View>
        <SyncedMemberRowContent
          member={mockMember}
          primaryColor="#007AFF"
        />
      </View>
    );
    expect(getByText("JD")).toBeTruthy();
  });
});

describe("UnsyncedPersonRowContent", () => {
  const mockPerson: UnsyncedPerson = {
    pcoPersonId: "pco-123",
    pcoName: "Jane Smith",
    teamName: "Band",
    position: "Guitar",
    reason: "not_in_group",
  };

  it("renders person name", () => {
    const { getByText } = render(
      <View>
        <UnsyncedPersonRowContent person={mockPerson} />
      </View>
    );
    expect(getByText("Jane Smith")).toBeTruthy();
  });

  it("shows team and position badges", () => {
    const { getByText } = render(
      <View>
        <UnsyncedPersonRowContent person={mockPerson} />
      </View>
    );
    expect(getByText("Band")).toBeTruthy();
    expect(getByText("Guitar")).toBeTruthy();
  });

  it("shows reason text", () => {
    const { getByText } = render(
      <View>
        <UnsyncedPersonRowContent person={mockPerson} />
      </View>
    );
    expect(getByText("In community but not in this group")).toBeTruthy();
  });

  it("renders initials", () => {
    const { getByText } = render(
      <View>
        <UnsyncedPersonRowContent person={mockPerson} />
      </View>
    );
    expect(getByText("JS")).toBeTruthy();
  });

  it("handles different reason codes", () => {
    const personNotInCommunity: UnsyncedPerson = {
      ...mockPerson,
      reason: "not_in_community",
    };
    const { getByText } = render(
      <View>
        <UnsyncedPersonRowContent person={personNotInCommunity} />
      </View>
    );
    expect(getByText("Not in this community")).toBeTruthy();
  });
});
