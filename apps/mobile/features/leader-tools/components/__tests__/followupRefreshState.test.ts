import {
  formatFollowupRefreshTimestamp,
  getFollowupRefreshButtonLabel,
} from "../followupRefreshState";

describe("followupRefreshState", () => {
  it("formats refresh timestamps for display", () => {
    expect(formatFollowupRefreshTimestamp(1735689600000)).toContain("Jan");
  });

  it("returns button labels for each refresh state", () => {
    expect(getFollowupRefreshButtonLabel(true, false)).toBe("Starting Refresh...");
    expect(getFollowupRefreshButtonLabel(false, true)).toBe("Refresh In Progress...");
    expect(getFollowupRefreshButtonLabel(false, false)).toBe("Refresh Follow-up Table Now");
  });

  it("returns null when timestamp is missing", () => {
    expect(formatFollowupRefreshTimestamp(undefined)).toBeNull();
    expect(formatFollowupRefreshTimestamp(null)).toBeNull();
  });
});
