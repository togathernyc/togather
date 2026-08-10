/**
 * `isCardSlotFull` / `countLiveCards` — the client-side mirror of
 * `assertFundCardSlotFree` in `apps/convex/functions/finance/cards.ts`.
 *
 * The case that matters is RETRY. A card whose provisioning was refused by the
 * provider (Privacy's "Insufficient privileges to create UNLOCKED cards", the
 * real staging failure) lands as `failed`, and the server frees the fund's
 * slot for it — so the Create-card button has to come back. A client denylist
 * that missed `failed` would leave the fund with one dead card and no way to
 * replace it, while the server would have said yes all along.
 */
import { countLiveCards, isCardSlotFull } from "../types";

describe("countLiveCards", () => {
  it("counts a pending card — it's a card about to exist at the issuer", () => {
    expect(countLiveCards([{ status: "pending" }, { status: "active" }])).toBe(2);
  });

  it("doesn't count the dead ones, in any spelling the DB may hold", () => {
    expect(
      countLiveCards([
        { status: "canceled" },
        { status: "closed" },
        { status: "CLOSED" },
        { status: "failed" },
      ]),
    ).toBe(0);
  });

  it("counts a frozen card — it's disabled, not gone", () => {
    expect(countLiveCards([{ status: "disabled" }])).toBe(1);
  });
});

describe("isCardSlotFull", () => {
  it("is never full where the provider declares no cap", () => {
    expect(
      isCardSlotFull([{ status: "active" }, { status: "active" }], null),
    ).toBe(false);
  });

  it("is full at a one-card provider once a live card exists", () => {
    expect(isCardSlotFull([{ status: "active" }], 1)).toBe(true);
  });

  // The retry case.
  it("is NOT full when the fund's only card failed to issue", () => {
    expect(isCardSlotFull([{ status: "failed" }], 1)).toBe(false);
  });

  it("stays free after several failed attempts", () => {
    expect(
      isCardSlotFull([{ status: "failed" }, { status: "failed" }], 1),
    ).toBe(false);
  });

  it("is empty-safe", () => {
    expect(isCardSlotFull([], 1)).toBe(false);
  });
});
