import React from "react";
import { render, screen } from "@testing-library/react-native";
import { GroupMapSection } from "../GroupMapSection";

// Mock Ionicons
jest.mock("@expo/vector-icons", () => ({
  Ionicons: "Ionicons",
}));

describe("GroupMapSection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders map section when location is provided", () => {
    const group = {
      _id: "group_1",
      id: 1,
      title: "Test Group",
      location: "123 Main St, City, State 12345",
    };

    render(<GroupMapSection group={group} />);

    expect(screen.getByText("LOCATION")).toBeTruthy();
    expect(screen.getByText("123 Main St, City, State 12345")).toBeTruthy();
    expect(screen.getByText("Open in Maps")).toBeTruthy();
  });

  it("does not render when location is missing", () => {
    const group = {
      _id: "group_2",
      id: 1,
      title: "Test Group",
    };

    render(<GroupMapSection group={group} />);
    expect(screen.queryByText("LOCATION")).toBeNull();
  });

  it("does not render when location is empty string", () => {
    const group = {
      _id: "group_3",
      id: 1,
      title: "Test Group",
      location: "",
    };

    render(<GroupMapSection group={group} />);
    expect(screen.queryByText("LOCATION")).toBeNull();
  });

  it("renders open maps button", () => {
    const group = {
      _id: "group_4",
      id: 1,
      title: "Test Group",
      location: "123 Main St",
    };

    render(<GroupMapSection group={group} />);

    expect(screen.getByText("Open in Maps")).toBeTruthy();
  });
});

