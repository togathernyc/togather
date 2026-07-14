import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

// AvailabilityPicker lives in RosterGridScreen, which pulls in Convex, router,
// theming, and several heavy sibling components at import time. The picker
// itself only needs RN + Ionicons + ModalShell + styles, so we stub the heavy
// modules so the module can load in isolation.
jest.mock("@services/api/convex", () => ({
  api: { functions: {} },
  useAuthenticatedQuery: jest.fn(),
  useAuthenticatedMutation: jest.fn(() => jest.fn()),
  useAuthenticatedAction: jest.fn(() => jest.fn()),
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => false }),
  useLocalSearchParams: () => ({ group_id: "group-1" }),
}));
jest.mock("@hooks/useTheme", () => ({ useTheme: () => ({ colors: {} }) }));
jest.mock("@hooks/useCommunityTheme", () => ({
  useCommunityTheme: () => ({ primaryColor: "#2563EB" }),
}));
jest.mock("../AssignSheet", () => ({ AssignSheet: () => null }));
jest.mock("../GridPresenceBar", () => ({ GridPresenceBar: () => null }));
jest.mock("../EventEditorPanel", () => ({ EventEditorPanel: () => null }));
jest.mock("../DateColumnHeaderEditor", () => ({ DateColumnHeaderEditor: () => null }));
jest.mock("../TeamChannelToggle", () => ({ TeamChannelToggle: () => null }));

import { AvailabilityPicker } from "../RosterGridScreen";

const COLORS = {
  text: "#000",
  textSecondary: "#555",
  textTertiary: "#999",
  surface: "#fff",
  border: "#ccc",
  link: "#2563EB",
} as any;

// Two upcoming events; the picker treats `_id` as the plan id it hands back.
const EVENTS = [
  {
    _id: "plan-1",
    title: "Sunday Service",
    eventDate: new Date("2026-07-19T09:00:00").getTime(),
    times: [{ label: "9:00 AM", startsAt: 0 }],
    status: "draft",
    pendingCount: 0,
  },
  {
    _id: "plan-2",
    title: "Sunday Service",
    eventDate: new Date("2026-07-26T09:00:00").getTime(),
    times: [{ label: "9:00 AM", startsAt: 0 }],
    status: "draft",
    pendingCount: 0,
  },
] as any;

describe("AvailabilityPicker", () => {
  it("starts with every event checked and the count on the Share button", () => {
    const { getByLabelText } = render(
      <AvailabilityPicker
        events={EVENTS}
        sharingLink={false}
        colors={COLORS}
        onShare={jest.fn()}
        onClose={jest.fn()}
      />,
    );
    // All upcoming events checked by default → button reflects the full count.
    expect(getByLabelText("Share link for 2 events")).toBeTruthy();
  });

  it("shares exactly the events left checked, in order", () => {
    const onShare = jest.fn();
    const { getByLabelText } = render(
      <AvailabilityPicker
        events={EVENTS}
        sharingLink={false}
        colors={COLORS}
        onShare={onShare}
        onClose={jest.fn()}
      />,
    );
    // Uncheck the second event, then share.
    fireEvent.press(getByLabelText("Sunday Service, Sun Jul 26"));
    fireEvent.press(getByLabelText("Share link for 1 event"));
    expect(onShare).toHaveBeenCalledWith(["plan-1"]);
  });

  it("disables Share and does not fire onShare when nothing is checked", () => {
    const onShare = jest.fn();
    const { getByLabelText } = render(
      <AvailabilityPicker
        events={EVENTS}
        sharingLink={false}
        colors={COLORS}
        onShare={onShare}
        onClose={jest.fn()}
      />,
    );
    fireEvent.press(getByLabelText("Sunday Service, Sun Jul 19"));
    fireEvent.press(getByLabelText("Sunday Service, Sun Jul 26"));
    // With nothing checked the Share button reports 0 and is disabled, so a tap
    // can't create a link (the backend also rejects an empty set).
    const shareBtn = getByLabelText("Share link for 0 events");
    expect(shareBtn.props.accessibilityState.disabled).toBe(true);
    expect(onShare).not.toHaveBeenCalled();
  });
});
