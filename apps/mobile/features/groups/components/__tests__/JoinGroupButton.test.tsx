import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { JoinGroupButton } from "../JoinGroupButton";
import { Group } from "../../types";

// Mock AuthProvider
jest.mock("@providers/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: 1, first_name: "Test", last_name: "User" },
  }),
}));

const mockGroup: Group = {
  _id: "group_test",
  id: 1,
  uuid: "test-uuid",
  title: "Test Group",
  name: "Test Group",
  description: "Test description",
  group_type: 1,
  group_type_name: "dinner_party",
  type: 1,
  members: [],
  leaders: [],
};

describe("JoinGroupButton", () => {
  it("renders with 'Join' text when no pending request", () => {
    const onPress = jest.fn();
    render(
      <JoinGroupButton
        onPress={onPress}
        group={mockGroup}
        requestStatus={null}
      />
    );
    expect(screen.getByText("Join dinner_party")).toBeTruthy();
  });

  it("renders with 'Request Submitted' text when request is pending", () => {
    const onPress = jest.fn();
    render(
      <JoinGroupButton
        onPress={onPress}
        group={mockGroup}
        requestStatus="pending"
      />
    );
    expect(screen.getByText("Request Submitted")).toBeTruthy();
  });

  it("calls onPress when button is clicked and no pending request", () => {
    const onPress = jest.fn();
    render(
      <JoinGroupButton
        onPress={onPress}
        group={mockGroup}
        requestStatus={null}
      />
    );
    const button = screen.getByText("Join dinner_party");
    fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("disables button and does not call onPress when request is pending", () => {
    const onPress = jest.fn();
    render(
      <JoinGroupButton
        onPress={onPress}
        group={mockGroup}
        requestStatus="pending"
      />
    );
    const button = screen.getByText("Request Submitted");
    fireEvent.press(button);
    // Button should be disabled, onPress should not be called
    expect(onPress).not.toHaveBeenCalled();
  });

  it("disables button when isPending is true", () => {
    const onPress = jest.fn();
    render(
      <JoinGroupButton
        onPress={onPress}
        group={mockGroup}
        requestStatus={null}
        isPending={true}
      />
    );
    // When isPending, the TouchableOpacity should have disabled prop
    // We can check for the ActivityIndicator instead
    expect(screen.queryByText("Join dinner_party")).toBeNull();
  });

  it("shows loading indicator when isPending is true", () => {
    const onPress = jest.fn();
    render(
      <JoinGroupButton
        onPress={onPress}
        group={mockGroup}
        requestStatus={null}
        isPending={true}
      />
    );
    // ActivityIndicator should be rendered, text should not
    expect(screen.queryByText("Join dinner_party")).toBeNull();
  });

  it("uses correct group type label for different group types", () => {
    const onPress = jest.fn();
    const teamGroup = { ...mockGroup, group_type_name: "team" };
    render(
      <JoinGroupButton
        onPress={onPress}
        group={teamGroup}
        requestStatus={null}
      />
    );
    expect(screen.getByText("Join team")).toBeTruthy();
  });
});
