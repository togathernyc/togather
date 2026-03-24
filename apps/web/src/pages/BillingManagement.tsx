import { useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useQuery, useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useWebAuth } from "../hooks/useWebAuth";

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

function CreditCardIcon({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) {
    return (
      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-neutral-100 text-neutral-600 border border-neutral-200">
        Unknown
      </span>
    );
  }

  const styles: Record<string, string> = {
    active: "bg-green-50 text-green-700 border border-green-200",
    past_due: "bg-amber-50 text-amber-700 border border-amber-200",
    canceled: "bg-red-50 text-red-700 border border-red-200",
    unpaid: "bg-red-50 text-red-700 border border-red-200",
    trialing: "bg-blue-50 text-blue-700 border border-blue-200",
    incomplete: "bg-amber-50 text-amber-700 border border-amber-200",
  };

  const labels: Record<string, string> = {
    active: "Active",
    past_due: "Past Due",
    canceled: "Canceled",
    unpaid: "Unpaid",
    trialing: "Trialing",
    incomplete: "Incomplete",
  };

  return (
    <span
      className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${styles[status] ?? "bg-neutral-100 text-neutral-600 border border-neutral-200"}`}
    >
      {labels[status] ?? status}
    </span>
  );
}

function formatPrice(amount: number | null): string {
  if (amount == null) return "--";
  return `$${amount.toLocaleString()}`;
}

export default function BillingManagement() {
  const { communityId } = useParams<{ communityId: string }>();
  const navigate = useNavigate();
  const { token, isAuthenticated } = useWebAuth();

  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState("");

  const billing = useQuery(
    api.functions.billing.getSubscriptionStatus,
    token && communityId
      ? { token, communityId: communityId as Id<"communities"> }
      : "skip"
  );

  const createPortalSession = useAction(
    api.functions.billing.createPortalSession
  );

  // Redirect unauthenticated users
  if (!isAuthenticated) {
    navigate(
      `/signin?redirect=/billing/${communityId ?? ""}`,
      { replace: true }
    );
    return null;
  }

  async function handleManageBilling() {
    if (!token || !communityId) return;

    setPortalLoading(true);
    setPortalError("");

    try {
      const result = await createPortalSession({ token, communityId });
      window.location.href = result.url;
    } catch (err) {
      setPortalError(
        err instanceof Error
          ? err.message
          : "Failed to open billing portal. Please try again."
      );
      setPortalLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-2xl mx-auto px-6 py-12">
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
            Billing
          </h1>
          <p className="text-lg text-neutral-600">
            Manage your community's subscription and payment details.
          </p>
        </div>

        {/* Loading state */}
        {billing === undefined ? (
          <LoadingSpinner />
        ) : (
          <>
            {/* Billing card */}
            <div className="bg-white border border-neutral-200 rounded-2xl p-6 md:p-8 mb-6">
              {/* Card header */}
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-neutral-100 rounded-xl flex items-center justify-center flex-shrink-0">
                  <CreditCardIcon className="w-5 h-5 text-neutral-600" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-neutral-900">
                    Subscription
                  </h2>
                </div>
              </div>

              {/* Info rows */}
              <div className="space-y-5">
                {/* Status */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-neutral-500">
                    Status
                  </span>
                  <StatusBadge status={billing.subscriptionStatus} />
                </div>

                {/* Divider */}
                <div className="border-t border-neutral-100" />

                {/* Monthly price */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-neutral-500">
                    Monthly Price
                  </span>
                  <span className="text-lg font-semibold text-neutral-900">
                    {formatPrice(billing.subscriptionPriceMonthly)}/month
                  </span>
                </div>

                {/* Divider */}
                <div className="border-t border-neutral-100" />

                {/* Billing email */}
                {billing.billingEmail && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-neutral-500">
                        Billing Email
                      </span>
                      <span className="text-sm text-neutral-700">
                        {billing.billingEmail}
                      </span>
                    </div>
                    <div className="border-t border-neutral-100" />
                  </>
                )}
              </div>

              {/* Manage button */}
              <div className="mt-8">
                <button
                  onClick={handleManageBilling}
                  disabled={portalLoading || !billing.stripeCustomerId}
                  className="w-full rounded-xl bg-neutral-900 hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed px-5 py-3 text-sm font-semibold text-white transition-colors cursor-pointer"
                >
                  {portalLoading ? "Opening Billing Portal..." : "Manage Billing"}
                </button>

                {!billing.stripeCustomerId && (
                  <p className="mt-3 text-sm text-neutral-500 text-center">
                    No billing account found. Subscription may not be set up
                    yet.
                  </p>
                )}

                {portalError && (
                  <p className="mt-3 text-sm text-red-600 text-center">
                    {portalError}
                  </p>
                )}
              </div>
            </div>

            {/* Info note */}
            <div className="bg-primary-50 rounded-xl border border-primary-100 p-5">
              <p className="text-sm text-neutral-700 leading-relaxed">
                <span className="font-medium text-neutral-800">Note:</span>{" "}
                Billing is managed on the web for App Store compliance. If you
                use the iOS app, manage your subscription here.
              </p>
            </div>

            {/* Past due warning */}
            {billing.subscriptionStatus === "past_due" && (
              <div className="mt-4 bg-amber-50 rounded-xl border border-amber-200 p-5">
                <p className="text-sm text-amber-800 leading-relaxed">
                  <span className="font-semibold">Payment past due.</span>{" "}
                  Please update your payment method to keep your community
                  active. Click "Manage Billing" above to update your card.
                </p>
              </div>
            )}

            {/* Canceled warning */}
            {billing.subscriptionStatus === "canceled" && (
              <div className="mt-4 bg-red-50 rounded-xl border border-red-200 p-5">
                <p className="text-sm text-red-800 leading-relaxed">
                  <span className="font-semibold">
                    Subscription canceled.
                  </span>{" "}
                  Your community may lose access to certain features. Contact
                  support to reactivate.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
