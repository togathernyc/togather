/**
 * The group route is the whatsapp-shell branch point: flag on renders the
 * W13 GroupInfoScreen, flag off must render the untouched GroupDetailScreen.
 * This file exists to pin the PR's core claim (flag-off = identical).
 */
import React from "react";
import { render } from "@testing-library/react-native";

const mockUseWhatsappShell = jest.fn(() => false);
jest.mock("@hooks/useWhatsappShell", () => ({
  useWhatsappShell: () => mockUseWhatsappShell(),
}));
jest.mock("@features/groups/components/GroupDetailScreen", () => ({
  GroupDetailScreen: () => {
    const { Text } = require("react-native");
    return <Text>detail-screen</Text>;
  },
}));
jest.mock("@features/groups/components/GroupInfoScreen", () => ({
  GroupInfoScreen: () => {
    const { Text } = require("react-native");
    return <Text>info-screen</Text>;
  },
}));

import GroupRoute from "../groups/[group_id]/index";

describe("groups/[group_id] route flag branch", () => {
  test("flag off renders GroupDetailScreen", () => {
    mockUseWhatsappShell.mockReturnValue(false);
    const { getByText, queryByText } = render(<GroupRoute />);
    expect(getByText("detail-screen")).toBeTruthy();
    expect(queryByText("info-screen")).toBeNull();
  });

  test("flag on renders GroupInfoScreen", () => {
    mockUseWhatsappShell.mockReturnValue(true);
    const { getByText, queryByText } = render(<GroupRoute />);
    expect(getByText("info-screen")).toBeTruthy();
    expect(queryByText("detail-screen")).toBeNull();
  });
});
