/**
 * GroupedInboxItem — long-press parity between a cluster's rows (issue #781).
 *
 * The expand/collapse action sheet is GROUP-scoped, so every row of a group's
 * cluster — the parent row and each nested channel row — must open the same
 * sheet. Before the fix only the parent row had `onLongPress`, so long-pressing
 * a nested channel row did nothing and the gesture felt broken.
 *
 * Asserted in BOTH shell states: the flag-off cluster (sub-channel cards) and
 * the flag-on whatsapp cluster (flat sub-rows) render different trees.
 */
import React from "react";
import { ActionSheetIOS } from "react-native";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { GroupedInboxItem } from "../GroupedInboxItem";
import { useWhatsappShell } from "@hooks/useWhatsappShell";

jest.mock("@hooks/useWhatsappShell", () => ({
  useWhatsappShell: jest.fn(() => false),
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

jest.mock("@providers/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

jest.mock("@hooks/useCommunityTheme", () => ({
  useCommunityTheme: () => ({ primaryColor: "#25D366" }),
}));

jest.mock("../../hooks/usePrefetchChannel", () => ({
  useAwaitPrefetch: () => jest.fn(async () => {}),
  useTriggerPrefetch: () => jest.fn(),
}));

const GROUP = {
  _id: "group-1" as any,
  name: "Worship Team",
  preview: undefined,
  groupTypeId: "type-1" as any,
  groupTypeName: "Team",
  groupTypeSlug: "team",
  isAnnouncementGroup: false,
};

const channel = (id: string, name: string, channelType: string) => ({
  _id: id as any,
  slug: name.toLowerCase(),
  channelType,
  name,
  lastMessagePreview: `hello from ${name}`,
  lastMessageAt: 1_700_000_000_000,
  lastMessageSenderName: "Sam",
  lastMessageSenderId: "user-2" as any,
  unreadCount: 0,
});

const CHANNELS = [
  channel("channel-1", "General", "main"),
  channel("channel-2", "Prayer", "custom"),
];

function renderItem(onToggleExpand: () => void) {
  return render(
    <GroupedInboxItem
      group={GROUP}
      channels={CHANNELS}
      userRole="member"
      isExpanded
      onToggleExpand={onToggleExpand}
      onToggleCollapse={jest.fn()}
    />
  );
}

describe("GroupedInboxItem long-press (issue #781)", () => {
  // The real implementation reaches for the native ActionSheetManager, which
  // doesn't exist under jest — stub it and assert on the options instead.
  const showActionSheet = jest
    .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
    .mockImplementation(() => {});

  beforeEach(() => {
    jest.clearAllMocks();
    (useWhatsappShell as jest.Mock).mockReturnValue(false);
  });

  describe.each([
    ["flag-off cluster", false],
    ["whatsapp-shell cluster", true],
  ])("%s", (_label, shellEnabled) => {
    beforeEach(() => {
      (useWhatsappShell as jest.Mock).mockReturnValue(shellEnabled);
    });

    it("opens the group's expand/collapse sheet from the parent row", () => {
      const onToggleExpand = jest.fn();
      renderItem(onToggleExpand);

      fireEvent(screen.getByText("Worship Team"), "longPress");

      expect(showActionSheet).toHaveBeenCalledTimes(1);
      expect(showActionSheet.mock.calls[0][0].options).toEqual([
        "Cancel",
        "Collapse",
      ]);
    });

    it("opens the same sheet from a nested channel row", () => {
      const onToggleExpand = jest.fn();
      renderItem(onToggleExpand);

      fireEvent(screen.getByText("Prayer"), "longPress");

      expect(showActionSheet).toHaveBeenCalledTimes(1);
      expect(showActionSheet.mock.calls[0][0].options).toEqual([
        "Cancel",
        "Collapse",
      ]);

      // Confirming the action toggles the parent GROUP, not the channel.
      showActionSheet.mock.calls[0][1](1);
      expect(onToggleExpand).toHaveBeenCalledTimes(1);
    });
  });
});
