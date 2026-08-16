import { adHocDisplayMembers } from "../adHocDisplayMembers";

const active = {
  userId: "u1" as never,
  displayName: "Carol Chen",
  profilePhoto: "https://example.com/carol.jpg",
  notificationsDisabled: true,
  isBirthdayToday: false,
};

const former = {
  userId: "u2" as never,
  displayName: "David Walker Jr.",
  profilePhoto: "https://example.com/david.jpg",
};

describe("adHocDisplayMembers", () => {
  it("returns the active members untouched when there are any", () => {
    expect(adHocDisplayMembers([active], former)).toEqual([active]);
  });

  it("falls back to the former member when nobody is active", () => {
    expect(adHocDisplayMembers([], former)).toEqual([
      {
        userId: former.userId,
        displayName: "David Walker Jr.",
        profilePhoto: former.profilePhoto,
        // Someone who left is not a notification target — never badge them.
        notificationsDisabled: false,
        // And `formerMember` is a snapshot, so it can't know their birthday.
        isBirthdayToday: false,
      },
    ]);
  });

  it("returns an empty list when there is no active and no former member", () => {
    expect(adHocDisplayMembers([], null)).toEqual([]);
  });
});
