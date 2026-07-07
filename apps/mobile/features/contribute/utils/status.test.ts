/**
 * Unit tests for the contribution status helpers — focused on isInProgress,
 * which powers the "In progress" tab (ADR-029 follow-up).
 */
import { isArchived, isInProgress, isYourTurn } from "./status";
import type { Contribution } from "../types";

type StatusInput = Pick<
  Contribution,
  "status" | "spec" | "specApprovedAt" | "scope" | "verifyOnStaging" | "stagingVerifiedAt"
>;

function make(overrides: Partial<StatusInput> & Pick<StatusInput, "status">): StatusInput {
  return { ...overrides };
}

describe("isInProgress", () => {
  it("is true while the AI is drafting the spec (DRAFT, no spec yet)", () => {
    expect(isInProgress(make({ status: "DRAFT" }))).toBe(true);
  });

  it("is true through the build/review pipeline states", () => {
    for (const status of [
      "READY_FOR_IMPL",
      "IN_PROGRESS",
      "CODE_REVIEW",
      "READY_TO_MERGE",
    ] as const) {
      expect(isInProgress(make({ status }))).toBe(true);
    }
  });

  it("is false when the item is waiting on the contributor (spec approval)", () => {
    const item = make({
      status: "IN_REVIEW",
      spec: "## Plan",
      scope: "buildable",
    });
    expect(isYourTurn(item)).toBe(true);
    expect(isInProgress(item)).toBe(false);
  });

  it("is false when a merged item awaits its staging check (ADR-029: staging is post-merge)", () => {
    // Nothing reaches staging until the merge, so the try-it window opens at
    // MERGED — an interactive item there is the contributor's turn, not "in
    // progress" and not yet "done".
    const item = make({
      status: "MERGED",
      verifyOnStaging: true,
    });
    expect(isYourTurn(item)).toBe(true);
    expect(isInProgress(item)).toBe(false);
  });

  it("does NOT treat an open PR as a staging check — nothing is on staging until merge", () => {
    // Interactive item still in code review / awaiting merge: the PR is open,
    // nothing is on staging, so it's still "in progress", not the user's turn.
    for (const status of ["CODE_REVIEW", "READY_TO_MERGE"] as const) {
      const item = make({ status, verifyOnStaging: true });
      expect(isYourTurn(item)).toBe(false);
      expect(isInProgress(item)).toBe(true);
    }
  });

  it("is false for shipped and closed items", () => {
    // Merged with the staging check already done (or never required).
    expect(
      isInProgress(make({ status: "MERGED", verifyOnStaging: true, stagingVerifiedAt: 123 })),
    ).toBe(false);
    expect(isInProgress(make({ status: "MERGED" }))).toBe(false);
    expect(isInProgress(make({ status: "REJECTED" }))).toBe(false);
  });

  it("is true for a submitted item still being reviewed (IN_REVIEW, no spec)", () => {
    expect(isInProgress(make({ status: "IN_REVIEW" }))).toBe(true);
  });

  it("routes human-gated IN_REVIEW states to Your turn, not In progress", () => {
    // A split item awaits the maintainer copying its slice prompts.
    const split = make({ status: "IN_REVIEW", spec: "## Plan", scope: "split" });
    expect(isYourTurn(split)).toBe(true);
    expect(isInProgress(split)).toBe(false);

    // A design_needed item awaits a maintainer decision.
    const design = make({ status: "IN_REVIEW", spec: "## Plan", scope: "design_needed" });
    expect(isYourTurn(design)).toBe(true);
    expect(isInProgress(design)).toBe(false);

    // An approved buildable item awaiting an explicit "Start build" tap.
    const approved = make({
      status: "IN_REVIEW",
      spec: "## Plan",
      scope: "buildable",
      specApprovedAt: 123,
    });
    expect(isYourTurn(approved)).toBe(true);
    expect(isInProgress(approved)).toBe(false);
  });
});

describe("isArchived", () => {
  it("is true only when archivedAt is set", () => {
    expect(isArchived({})).toBe(false);
    expect(isArchived({ archivedAt: undefined })).toBe(false);
    expect(isArchived({ archivedAt: 123 })).toBe(true);
  });
});
