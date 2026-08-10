import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

// The toggle only needs RN + Ionicons; Convex, theming and the platform alert
// helpers are stubbed so the module loads in isolation and we can assert on
// the exact confirm copy the leader sees.
jest.mock("@services/api/convex", () => ({
  api: {
    functions: {
      scheduling: { teams: { linkChannel: "linkChannel", unlinkChannel: "unlinkChannel" } },
    },
  },
  useAuthenticatedMutation: jest.fn(() => jest.fn()),
}));
jest.mock("@hooks/useTheme", () => ({
  useTheme: () => ({
    colors: { success: "#0a0", textTertiary: "#999", border: "#ccc" },
  }),
}));
jest.mock("@/utils/platformAlert", () => ({
  confirmAsync: jest.fn(() => Promise.resolve(false)),
  notify: jest.fn(),
}));

import { TeamChannelToggle } from "../TeamChannelToggle";
import { confirmAsync } from "@/utils/platformAlert";

const mockConfirm = confirmAsync as jest.MockedFunction<typeof confirmAsync>;

describe("TeamChannelToggle", () => {
  beforeEach(() => {
    mockConfirm.mockClear();
  });

  it("does not quote a member count when turning chat off", async () => {
    const { getByLabelText } = render(
      <TeamChannelToggle
        teamId={"team-1" as never}
        teamName="Hospitality"
        hasChannel
      />,
    );

    fireEvent.press(getByLabelText("Turn chat off for Hospitality"));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    const { title, message } = mockConfirm.mock.calls[0][0];
    expect(title).toBe("Turn off chat for Hospitality?");
    // The channel's total membership includes permanent members, so quoting a
    // number here would overstate what unlinking removes (issue #402).
    expect(message).not.toMatch(/\d/);
    expect(message).toContain("Auto-synced members will be removed");
    expect(message).toContain("permanent members");
  });

  it("still explains what turning chat on does", async () => {
    const { getByLabelText } = render(
      <TeamChannelToggle
        teamId={"team-1" as never}
        teamName="Hospitality"
        hasChannel={false}
      />,
    );

    fireEvent.press(getByLabelText("Turn chat on for Hospitality"));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockConfirm.mock.calls[0][0].title).toBe(
      "Turn on chat for Hospitality?",
    );
  });
});
