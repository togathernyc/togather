/**
 * Unit tests for the contribution status helpers — focused on isInProgress,
 * which powers the "In progress" tab (ADR-029 follow-up).
 */
import {
  isArchived,
  isInProgress,
  isStagingDeployLive,
  isYourTurn,
  needsStagingVerify,
  isRerun,
  statusPresentation,
} from "./status";
import type { Contribution } from "../types";

type StatusInput = Pick<
  Contribution,
  | "status"
  | "spec"
  | "specApprovedAt"
  | "scope"
  | "verifyOnStaging"
  | "stagingVerifiedAt"
  | "stagingDeploy"
  | "productionDeploy"
  | "fixRounds"
  | "redoRounds"
  | "activeRunMode"
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

describe("deploy observation — MERGED sub-states", () => {
  it("isStagingDeployLive: undefined (legacy) or 'live' is live; pending/failed is not", () => {
    expect(isStagingDeployLive({})).toBe(true);
    expect(
      isStagingDeployLive({ stagingDeploy: { state: "live", updatedAt: 1 } }),
    ).toBe(true);
    expect(
      isStagingDeployLive({ stagingDeploy: { state: "pending", updatedAt: 1 } }),
    ).toBe(false);
    expect(
      isStagingDeployLive({ stagingDeploy: { state: "failed", updatedAt: 1 } }),
    ).toBe(false);
  });

  it("needsStagingVerify only once the staging deploy is live", () => {
    const base = make({ status: "MERGED", verifyOnStaging: true });
    // Deploy still running / failed → don't invite a try-it yet.
    expect(
      needsStagingVerify({
        ...base,
        stagingDeploy: { state: "pending", updatedAt: 1 },
      }),
    ).toBe(false);
    expect(
      needsStagingVerify({
        ...base,
        stagingDeploy: { state: "failed", updatedAt: 1 },
      }),
    ).toBe(false);
    // Live (or legacy undefined) → the try-it window is open.
    expect(
      needsStagingVerify({
        ...base,
        stagingDeploy: { state: "live", updatedAt: 1 },
      }),
    ).toBe(true);
    expect(needsStagingVerify(base)).toBe(true);
  });

  it("statusPresentation reflects the staging deploy state on a merged item", () => {
    expect(
      statusPresentation(
        make({
          status: "MERGED",
          verifyOnStaging: true,
          stagingDeploy: { state: "pending", updatedAt: 1 },
        }),
      ).label,
    ).toBe("Deploying to staging…");
    expect(
      statusPresentation(
        make({
          status: "MERGED",
          verifyOnStaging: true,
          stagingDeploy: { state: "failed", updatedAt: 1 },
        }),
      ).label,
    ).toBe("Staging deploy failed");
    // Live interactive item → the existing "ready to try" label.
    expect(
      statusPresentation(
        make({
          status: "MERGED",
          verifyOnStaging: true,
          stagingDeploy: { state: "live", updatedAt: 1 },
        }),
      ).label,
    ).toBe("On staging — ready for you to try");
    // Legacy merged row with no deploy record still reads as live-on-staging.
    expect(statusPresentation(make({ status: "MERGED" })).label).toBe(
      "Live on staging",
    );
  });

  it("statusPresentation surfaces the production deploy state", () => {
    expect(
      statusPresentation(
        make({
          status: "MERGED",
          stagingVerifiedAt: 1,
          productionDeploy: { state: "pending", updatedAt: 1 },
        }),
      ).label,
    ).toBe("Deploying to production…");
    expect(
      statusPresentation(
        make({
          status: "MERGED",
          stagingVerifiedAt: 1,
          productionDeploy: { state: "live", updatedAt: 1 },
        }),
      ).label,
    ).toBe("Live in production");
    expect(
      statusPresentation(
        make({
          status: "MERGED",
          stagingVerifiedAt: 1,
          productionDeploy: { state: "failed", updatedAt: 1 },
        }),
      ).label,
    ).toBe("Production deploy failed");
  });

  it("a pending staging deploy keeps an interactive merged item OFF 'your turn'", () => {
    const item = make({
      status: "MERGED",
      verifyOnStaging: true,
      stagingDeploy: { state: "pending", updatedAt: 1 },
    });
    // Not the contributor's turn (nothing to try yet) and not "in progress"
    // either — it's a merged item waiting on its deploy.
    expect(isYourTurn(item)).toBe(false);
    expect(isInProgress(item)).toBe(false);
  });
});

describe("isArchived", () => {
  it("is true only when archivedAt is set", () => {
    expect(isArchived({})).toBe(false);
    expect(isArchived({ archivedAt: undefined })).toBe(false);
    expect(isArchived({ archivedAt: 123 })).toBe(true);
  });
});

describe("isRerun", () => {
  it("is true for a staging redo whose rebuild run is in flight (implement mode)", () => {
    expect(
      isRerun(make({ status: "IN_PROGRESS", redoRounds: 1, activeRunMode: "implement" })),
    ).toBe(true);
  });

  it("is true while a fix run is actively addressing review feedback (fix mode)", () => {
    expect(
      isRerun(make({ status: "CODE_REVIEW", fixRounds: 2, activeRunMode: "fix" })),
    ).toBe(true);
  });

  it("is false when the counter is set but no matching run is active (stale counter)", () => {
    // redoRounds recorded but the build hasn't been stamped yet (re-queued).
    expect(isRerun(make({ status: "IN_PROGRESS", redoRounds: 1 }))).toBe(false);
    // fixRounds recorded but no fix run in flight.
    expect(isRerun(make({ status: "CODE_REVIEW", fixRounds: 1 }))).toBe(false);
  });

  it("is false for an EXHAUSTED fix loop — needs a human, not actively fixing", () => {
    // Budget spent: the last dispatch was the review run (mode "review"), no
    // fix run was dispatched, yet fixRounds is still 3.
    expect(
      isRerun(make({ status: "CODE_REVIEW", fixRounds: 3, activeRunMode: "review" })),
    ).toBe(false);
  });

  it("is false once a redo's rebuild has reported back (mode moved to review)", () => {
    expect(
      isRerun(make({ status: "CODE_REVIEW", redoRounds: 1, activeRunMode: "review" })),
    ).toBe(false);
    expect(
      isRerun(make({ status: "READY_TO_MERGE", redoRounds: 1, activeRunMode: "review" })),
    ).toBe(false);
  });

  it("is false on a first build (no rounds) even with a run active", () => {
    expect(
      isRerun(make({ status: "IN_PROGRESS", activeRunMode: "implement" })),
    ).toBe(false);
    expect(isRerun(make({ status: "CODE_REVIEW", activeRunMode: "fix" }))).toBe(false);
  });

  it("is false outside the active build states even with rounds and a mode recorded", () => {
    // A merged item carries the counters + last mode, but is no longer reworking.
    expect(
      isRerun(make({ status: "MERGED", redoRounds: 1, fixRounds: 1, activeRunMode: "review" })),
    ).toBe(false);
  });
});

describe("statusPresentation — rerun framing", () => {
  it("frames a staging redo's active rebuild as reworking from the staging note", () => {
    expect(
      statusPresentation(
        make({ status: "IN_PROGRESS", redoRounds: 1, activeRunMode: "implement" }),
      ).label,
    ).toBe("Reworking from your staging note");
  });

  it("frames an active fix run as fixing review feedback", () => {
    expect(
      statusPresentation(
        make({ status: "CODE_REVIEW", fixRounds: 1, activeRunMode: "fix" }),
      ).label,
    ).toBe("Fixing review feedback");
  });

  it("does NOT show 'Fixing review feedback' for an exhausted fix loop", () => {
    // fixRounds spent, awaiting a human — mode is "review", not "fix".
    expect(
      statusPresentation(
        make({ status: "CODE_REVIEW", fixRounds: 3, activeRunMode: "review" }),
      ).label,
    ).toBe("In code review");
  });

  it("does NOT show a rerun label for a stale counter with no matching run", () => {
    expect(
      statusPresentation(make({ status: "IN_PROGRESS", redoRounds: 1 })).label,
    ).toBe("Building");
    expect(
      statusPresentation(make({ status: "CODE_REVIEW", fixRounds: 1 })).label,
    ).toBe("In code review");
  });

  it("falls back to the normal label once a redo's rebuild reported back", () => {
    expect(
      statusPresentation(
        make({ status: "CODE_REVIEW", redoRounds: 1, activeRunMode: "review" }),
      ).label,
    ).toBe("In code review");
  });

  it("keeps the generic labels for a first build (no rounds)", () => {
    expect(statusPresentation(make({ status: "READY_FOR_IMPL" })).label).toBe("Queued to build");
    expect(
      statusPresentation(make({ status: "IN_PROGRESS", activeRunMode: "implement" })).label,
    ).toBe("Building");
    expect(
      statusPresentation(make({ status: "CODE_REVIEW", activeRunMode: "fix" })).label,
    ).toBe("In code review");
  });

  it("keeps 'Queued to build' for a redo re-queued at READY_FOR_IMPL (no run yet)", () => {
    // The redo re-queues with activeRunMode cleared; the rework label waits for
    // the rebuild to start.
    expect(
      statusPresentation(make({ status: "READY_FOR_IMPL", redoRounds: 1 })).label,
    ).toBe("Queued to build");
  });
});
