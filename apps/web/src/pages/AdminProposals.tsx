import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useWebAuth } from "../hooks/useWebAuth";

/** Shape returned by `api.functions.proposals.list` */
interface Proposal {
  _id: Id<"communityProposals">;
  _creationTime: number;
  communityName: string;
  estimatedSize: number;
  needsMigration: boolean;
  proposedMonthlyPrice: number;
  notes?: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  reviewedAt?: number;
  reviewedById?: Id<"users">;
  rejectionReason?: string;
  communityId?: Id<"communities">;
  setupToken?: string;
  setupCompletedAt?: number;
  proposerId: Id<"users">;
  proposerName?: string;
  proposerPhone?: string;
  proposerEmail?: string;
}

type StatusFilter = "all" | "pending" | "accepted" | "rejected";

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending:
      "bg-amber-50 text-amber-700 border border-amber-200",
    accepted:
      "bg-green-50 text-green-700 border border-green-200",
    rejected:
      "bg-red-50 text-red-700 border border-red-200",
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${styles[status] ?? "bg-neutral-100 text-neutral-600 border border-neutral-200"}`}
    >
      {status}
    </span>
  );
}

function MigrationBadge({ needed }: { needed: boolean }) {
  return needed ? (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200">
      Yes
    </span>
  ) : (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-neutral-100 text-neutral-500 border border-neutral-200">
      No
    </span>
  );
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatPrice(cents: number): string {
  return `$${cents.toLocaleString()}/mo`;
}

function BackArrow() {
  return (
    <svg
      className="w-5 h-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-2 border-neutral-200 border-t-neutral-900 rounded-full animate-spin" />
    </div>
  );
}

function EmptyState({ status }: { status: StatusFilter }) {
  const messages: Record<StatusFilter, string> = {
    all: "No proposals have been submitted yet.",
    pending: "No pending proposals to review.",
    accepted: "No proposals have been accepted yet.",
    rejected: "No proposals have been rejected.",
  };

  return (
    <div className="text-center py-20">
      <div className="w-16 h-16 mx-auto mb-4 bg-neutral-100 rounded-2xl flex items-center justify-center">
        <svg
          className="w-8 h-8 text-neutral-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
          <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
        </svg>
      </div>
      <p className="text-neutral-500 text-lg">{messages[status]}</p>
    </div>
  );
}

export default function AdminProposals() {
  const { token, isAuthenticated } = useWebAuth();
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [rejectingId, setRejectingId] = useState<Id<"communityProposals"> | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionInProgress, setActionInProgress] = useState<Id<"communityProposals"> | null>(null);

  const queryStatus = statusFilter === "all" ? undefined : statusFilter;
  const proposals = useQuery(
    api.functions.proposals.list,
    token ? { token, status: queryStatus } : "skip"
  ) as Proposal[] | undefined;

  // Fetch all proposals (unfiltered) for accurate tab badge counts
  const allProposals = useQuery(
    api.functions.proposals.list,
    token ? { token } : "skip"
  ) as Proposal[] | undefined;

  const acceptMutation = useMutation(api.functions.proposals.accept);
  const rejectMutation = useMutation(api.functions.proposals.reject);

  // Redirect unauthenticated users
  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/onboarding/signin?redirect=/admin/proposals", { replace: true });
    }
  }, [isAuthenticated, navigate]);

  if (!isAuthenticated) {
    return null;
  }

  async function handleAccept(proposalId: Id<"communityProposals">, communityName: string) {
    if (!token) return;
    const confirmed = window.confirm(
      `Accept proposal for "${communityName}"?\n\nThis will create the community and notify the proposer.`
    );
    if (!confirmed) return;

    setActionInProgress(proposalId);
    try {
      await acceptMutation({ token, proposalId });
    } catch (error) {
      alert(`Failed to accept proposal: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setActionInProgress(null);
    }
  }

  async function handleReject(proposalId: Id<"communityProposals">) {
    if (!token) return;

    setActionInProgress(proposalId);
    try {
      await rejectMutation({
        token,
        proposalId,
        reason: rejectReason.trim() || undefined,
      });
      setRejectingId(null);
      setRejectReason("");
    } catch (error) {
      alert(`Failed to reject proposal: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setActionInProgress(null);
    }
  }

  const filterTabs: { key: StatusFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "pending", label: "Pending" },
    { key: "accepted", label: "Accepted" },
    { key: "rejected", label: "Rejected" },
  ];

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-5xl mx-auto px-6 py-12">
        {/* Back link */}
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-neutral-600 hover:text-neutral-900 mb-8"
        >
          <BackArrow />
          Back to Home
        </Link>

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-neutral-900 mb-3">
            Community Proposals
          </h1>
          <p className="text-lg text-neutral-600">
            Review and manage community proposals submitted by prospective leaders.
          </p>
        </div>

        {/* Status filter tabs */}
        <div className="mb-8">
          <div className="inline-flex flex-wrap gap-2">
            {filterTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key)}
                className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                  statusFilter === tab.key
                    ? "bg-neutral-900 text-white"
                    : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 hover:text-neutral-800"
                }`}
              >
                {tab.label}
                {allProposals && tab.key !== "all" && (
                  <span className="ml-1.5 text-xs opacity-70">
                    ({allProposals.filter((p) => p.status === tab.key).length})
                  </span>
                )}
                {allProposals && tab.key === "all" && (
                  <span className="ml-1.5 text-xs opacity-70">
                    ({allProposals.length})
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Proposals list */}
        {proposals === undefined ? (
          <LoadingSpinner />
        ) : proposals.length === 0 ? (
          <EmptyState status={statusFilter} />
        ) : (
          <div className="space-y-4">
            {proposals.map((proposal) => (
              <div
                key={proposal._id}
                className="bg-white border border-neutral-200 rounded-2xl p-6 hover:border-neutral-300 transition-colors"
              >
                {/* Top row: community name + status badge */}
                <div className="flex items-start justify-between gap-4 mb-4">
                  <h2 className="text-xl font-bold text-neutral-900">
                    {proposal.communityName}
                  </h2>
                  <StatusBadge status={proposal.status} />
                </div>

                {/* Info grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                  {/* Proposer info */}
                  <div>
                    <div className="text-xs font-medium text-neutral-400 uppercase tracking-wide mb-1">
                      Proposer
                    </div>
                    <div className="text-neutral-900 font-medium">
                      {proposal.proposerName ?? "Unknown"}
                    </div>
                    {proposal.proposerPhone && (
                      <div className="text-neutral-500 text-sm">
                        {proposal.proposerPhone}
                      </div>
                    )}
                    {proposal.proposerEmail && (
                      <div className="text-neutral-500 text-sm">
                        {proposal.proposerEmail}
                      </div>
                    )}
                  </div>

                  {/* Estimated size */}
                  <div>
                    <div className="text-xs font-medium text-neutral-400 uppercase tracking-wide mb-1">
                      Estimated Size
                    </div>
                    <div className="text-neutral-900 font-medium">
                      {proposal.estimatedSize.toLocaleString()} members
                    </div>
                  </div>

                  {/* Proposed price */}
                  <div>
                    <div className="text-xs font-medium text-neutral-400 uppercase tracking-wide mb-1">
                      Proposed Price
                    </div>
                    <div className="text-neutral-900 font-medium">
                      {formatPrice(proposal.proposedMonthlyPrice)}
                    </div>
                  </div>

                  {/* Migration needed */}
                  <div>
                    <div className="text-xs font-medium text-neutral-400 uppercase tracking-wide mb-1">
                      Migration Needed
                    </div>
                    <MigrationBadge needed={proposal.needsMigration} />
                  </div>

                  {/* Submitted date */}
                  <div>
                    <div className="text-xs font-medium text-neutral-400 uppercase tracking-wide mb-1">
                      Submitted
                    </div>
                    <div className="text-neutral-900 text-sm">
                      {formatDate(proposal.createdAt)}
                    </div>
                  </div>

                  {/* Reviewed date (if reviewed) */}
                  {proposal.reviewedAt && (
                    <div>
                      <div className="text-xs font-medium text-neutral-400 uppercase tracking-wide mb-1">
                        Reviewed
                      </div>
                      <div className="text-neutral-900 text-sm">
                        {formatDate(proposal.reviewedAt)}
                      </div>
                    </div>
                  )}
                </div>

                {/* Notes */}
                {proposal.notes && (
                  <div className="mb-4">
                    <div className="text-xs font-medium text-neutral-400 uppercase tracking-wide mb-1">
                      Notes
                    </div>
                    <p className="text-neutral-600 text-sm bg-neutral-50 rounded-xl p-3 border border-neutral-100">
                      {proposal.notes}
                    </p>
                  </div>
                )}

                {/* Rejection reason (if rejected) */}
                {proposal.status === "rejected" && proposal.rejectionReason && (
                  <div className="mb-4">
                    <div className="text-xs font-medium text-red-400 uppercase tracking-wide mb-1">
                      Rejection Reason
                    </div>
                    <p className="text-red-700 text-sm bg-red-50 rounded-xl p-3 border border-red-100">
                      {proposal.rejectionReason}
                    </p>
                  </div>
                )}

                {/* Action buttons for pending proposals */}
                {proposal.status === "pending" && (
                  <div className="pt-4 border-t border-neutral-100">
                    {rejectingId === proposal._id ? (
                      /* Reject form */
                      <div className="space-y-3">
                        <label className="block">
                          <span className="text-sm font-medium text-neutral-700">
                            Rejection reason (optional)
                          </span>
                          <textarea
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            placeholder="Explain why this proposal is being rejected..."
                            rows={3}
                            className="mt-1 block w-full rounded-xl border border-neutral-200 px-4 py-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400 resize-none"
                          />
                        </label>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleReject(proposal._id)}
                            disabled={actionInProgress === proposal._id}
                            className="px-5 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-colors cursor-pointer"
                          >
                            {actionInProgress === proposal._id
                              ? "Rejecting..."
                              : "Confirm Reject"}
                          </button>
                          <button
                            onClick={() => {
                              setRejectingId(null);
                              setRejectReason("");
                            }}
                            disabled={actionInProgress === proposal._id}
                            className="px-5 py-2.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm font-medium rounded-xl transition-colors cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* Action buttons */
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() =>
                            handleAccept(proposal._id, proposal.communityName)
                          }
                          disabled={actionInProgress === proposal._id}
                          className="px-5 py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-colors cursor-pointer"
                        >
                          {actionInProgress === proposal._id
                            ? "Accepting..."
                            : "Accept"}
                        </button>
                        <button
                          onClick={() => setRejectingId(proposal._id)}
                          disabled={actionInProgress === proposal._id}
                          className="px-5 py-2.5 bg-red-50 hover:bg-red-100 text-red-700 text-sm font-medium rounded-xl border border-red-200 transition-colors cursor-pointer"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
