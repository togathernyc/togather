/**
 * DirectMessageRow — the 1:1 inbox row must keep a name when the counterpart
 * is gone (issue #426).
 *
 * The 30-day `expireOldChatRequests` cron marks a never-answered request
 * `declined` + `leftAt`, which empties `otherMembers` for the SENDER too, so
 * their row used to degrade to a nameless "Conversation". The backend now
 * returns the departed person separately as `formerMember`; this asserts the
 * row actually renders it.
 */
import React from "react";
import { render, screen } from "@testing-library/react-native";
import { DirectMessageRow } from "../ChatInboxScreen";

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
}));

type RowProps = React.ComponentProps<typeof DirectMessageRow>;
type Row = RowProps["row"];

const colors: RowProps["colors"] = {
  text: "#000000",
  textSecondary: "#333333",
  textTertiary: "#666666",
  surface: "#ffffff",
  surfaceSecondary: "#eeeeee",
};

const baseRow: Row = {
  channelId: "channel-1" as Row["channelId"],
  channelType: "dm",
  channelName: "",
  memberCount: 2,
  otherMembers: [],
  formerMember: null,
  lastMessageAt: 1_700_000_000_000,
  lastMessagePreview: "hey",
  lastMessageSenderName: "Alice",
  lastMessageSenderId: null,
  lastMessageSenderNotificationsDisabled: false,
  unreadCount: 0,
  isMuted: false,
};

const renderRow = (row: Row, whatsappShellEnabled = false) =>
  render(
    <DirectMessageRow
      row={row}
      primaryColor="#25D366"
      colors={colors}
      whatsappShellEnabled={whatsappShellEnabled}
    />,
  );

const formerMember: NonNullable<Row["formerMember"]> = {
  userId: "user-2" as NonNullable<Row["formerMember"]>["userId"],
  displayName: "David Walker",
  profilePhoto: null,
};

describe("DirectMessageRow — departed 1:1 counterpart", () => {
  test("renders the active member's name while they are still in the chat", () => {
    renderRow({
      ...baseRow,
      otherMembers: [
        {
          userId: "user-2" as Row["otherMembers"][number]["userId"],
          displayName: "David Walker",
          profilePhoto: null,
          notificationsDisabled: false,
        },
      ],
    });

    expect(screen.getByText("David Walker")).toBeTruthy();
    expect(screen.queryByText("Conversation")).toBeNull();
  });

  test.each([
    ["flag off", false],
    ["flag on", true],
  ])(
    "renders the departed member's name instead of 'Conversation' (%s)",
    (_label, whatsappShellEnabled) => {
      renderRow({ ...baseRow, formerMember }, whatsappShellEnabled as boolean);

      expect(screen.getByText("David Walker")).toBeTruthy();
      expect(screen.queryByText("Conversation")).toBeNull();
    },
  );

  test("still falls back to 'Conversation' when nobody can be resolved", () => {
    // e.g. the counterpart blocked the caller — the backend withholds them
    // rather than naming the blocker.
    renderRow(baseRow);

    expect(screen.getByText("Conversation")).toBeTruthy();
  });
});
