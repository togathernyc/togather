import { useState, useEffect, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useWebAuth } from "../hooks/useWebAuth";

export default function ProposeCommunity() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { token, isAuthenticated, signIn } = useWebAuth();

  // New users arrive with phoneVerificationToken + phone from the sign-in page
  const phoneVerificationToken = searchParams.get("phoneVerificationToken");
  const phone = searchParams.get("phone");
  const hasVerificationToken = !!(phoneVerificationToken && phone);

  // Redirect to sign-in only when there is no auth AND no verification token
  useEffect(() => {
    if (!isAuthenticated && !hasVerificationToken) {
      navigate("/onboarding/signin?redirect=/onboarding/proposal", { replace: true });
    }
  }, [isAuthenticated, hasVerificationToken, navigate]);

  const submitProposal = useMutation(api.functions.proposals.submit);
  const registerNewUser = useAction(api.functions.auth.registration.registerNewUser);

  // New-user registration fields (shown when using phoneVerificationToken)
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");

  const [communityName, setCommunityName] = useState("");
  const [estimatedSize, setEstimatedSize] = useState("");
  const [needsMigration, setNeedsMigration] = useState(false);
  const [proposedMonthlyPrice, setProposedMonthlyPrice] = useState("200");
  const [notes, setNotes] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  if (!isAuthenticated && !hasVerificationToken) {
    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!communityName.trim()) {
      setError("Community name is required.");
      return;
    }

    const size = Number(estimatedSize);
    if (!estimatedSize || isNaN(size) || size < 1) {
      setError("Please enter a valid estimated number of people.");
      return;
    }

    const price = Number(proposedMonthlyPrice);
    if (!proposedMonthlyPrice || isNaN(price) || price < 0) {
      setError("Please enter a valid proposed monthly price.");
      return;
    }

    // If the user is a new user with a verification token, register first
    let authToken = token;
    if (!authToken && hasVerificationToken) {
      if (!firstName.trim() || !lastName.trim()) {
        setError("First name and last name are required.");
        return;
      }

      setIsSubmitting(true);
      try {
        const result = await registerNewUser({
          phone: phone!,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim() || undefined,
          otp: "000000", // Already verified via phoneVerificationToken
          phoneVerificationToken: phoneVerificationToken!,
        });
        signIn(result.access_token, result.refresh_token);
        authToken = result.access_token;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Registration failed. Please try again."
        );
        setIsSubmitting(false);
        return;
      }
    }

    if (!authToken) {
      setError("You must be signed in to submit a proposal.");
      return;
    }

    setIsSubmitting(true);
    try {
      await submitProposal({
        token: authToken,
        communityName: communityName.trim(),
        estimatedSize: size,
        needsMigration,
        proposedMonthlyPrice: price,
        notes: notes.trim() || undefined,
      });
      setSubmitted(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong. Please try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-white">
        <div className="max-w-2xl mx-auto px-6 py-12">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-neutral-600 hover:text-neutral-900 mb-8"
          >
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back to Home
          </Link>

          <div className="bg-accent-500/10 border border-accent-500/30 rounded-2xl p-8 text-center">
            <div className="w-14 h-14 bg-accent-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-7 h-7 text-white"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-neutral-900 mb-2">
              Proposal submitted
            </h2>
            <p className="text-neutral-600 leading-relaxed">
              Thanks! We've received your proposal. We'll review it and get back
              to you via email.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-2xl mx-auto px-6 py-12">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-neutral-600 hover:text-neutral-900 mb-8"
        >
          <svg
            className="w-5 h-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to Home
        </Link>

        <h1 className="text-4xl font-bold text-neutral-900 mb-3">
          Propose a community
        </h1>
        <p className="text-lg text-neutral-600 mb-8 leading-relaxed">
          Tell us about your community and we'll get you set up on Togather.
        </p>

        {/* Beta messaging banner */}
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 mb-10">
          <p className="text-amber-900 leading-relaxed text-sm">
            Togather is open-source software. This subscription covers hosting,
            support, and ongoing development. You're always free to self-host.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* New user: collect name + email */}
          {hasVerificationToken && !isAuthenticated && (
            <>
              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6 mb-2">
                <p className="text-blue-900 leading-relaxed text-sm">
                  Welcome! Tell us a bit about yourself to create your account.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="firstName"
                    className="block text-sm font-medium text-neutral-900 mb-1.5"
                  >
                    First name <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="firstName"
                    type="text"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Jane"
                    className="w-full px-4 py-3 rounded-xl border border-neutral-300 bg-white text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
                  />
                </div>
                <div>
                  <label
                    htmlFor="lastName"
                    className="block text-sm font-medium text-neutral-900 mb-1.5"
                  >
                    Last name <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="lastName"
                    type="text"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Doe"
                    className="w-full px-4 py-3 rounded-xl border border-neutral-300 bg-white text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
                  />
                </div>
              </div>
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-neutral-900 mb-1.5"
                >
                  Email{" "}
                  <span className="text-neutral-400 font-normal">(optional)</span>
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jane@example.com"
                  className="w-full px-4 py-3 rounded-xl border border-neutral-300 bg-white text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
                />
              </div>

              <hr className="border-neutral-200" />
            </>
          )}

          {/* Community name */}
          <div>
            <label
              htmlFor="communityName"
              className="block text-sm font-medium text-neutral-900 mb-1.5"
            >
              Community name <span className="text-red-500">*</span>
            </label>
            <input
              id="communityName"
              type="text"
              required
              value={communityName}
              onChange={(e) => setCommunityName(e.target.value)}
              placeholder="e.g. Grace Church NYC"
              className="w-full px-4 py-3 rounded-xl border border-neutral-300 bg-white text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
            />
          </div>

          {/* Estimated number of people */}
          <div>
            <label
              htmlFor="estimatedSize"
              className="block text-sm font-medium text-neutral-900 mb-1.5"
            >
              Estimated number of people <span className="text-red-500">*</span>
            </label>
            <input
              id="estimatedSize"
              type="number"
              required
              min="1"
              value={estimatedSize}
              onChange={(e) => setEstimatedSize(e.target.value)}
              placeholder="e.g. 150"
              className="w-full px-4 py-3 rounded-xl border border-neutral-300 bg-white text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
            />
          </div>

          {/* Migration checkbox */}
          <div>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={needsMigration}
                onChange={(e) => setNeedsMigration(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900"
              />
              <span className="text-sm text-neutral-900">
                Need help migrating from another platform?
              </span>
            </label>
            {needsMigration && (
              <div className="mt-3 ml-7 bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3">
                <p className="text-sm text-neutral-600">
                  Migration assistance is a one-time $500 flat fee.
                </p>
              </div>
            )}
          </div>

          {/* Proposed monthly price */}
          <div>
            <label
              htmlFor="proposedMonthlyPrice"
              className="block text-sm font-medium text-neutral-900 mb-1.5"
            >
              Proposed monthly price <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500 font-medium">
                $
              </span>
              <input
                id="proposedMonthlyPrice"
                type="number"
                required
                min="0"
                value={proposedMonthlyPrice}
                onChange={(e) => setProposedMonthlyPrice(e.target.value)}
                className="w-full pl-8 pr-4 py-3 rounded-xl border border-neutral-300 bg-white text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
              />
            </div>
          </div>

          {/* Additional notes */}
          <div>
            <label
              htmlFor="notes"
              className="block text-sm font-medium text-neutral-900 mb-1.5"
            >
              Additional notes{" "}
              <span className="text-neutral-400 font-normal">(optional)</span>
            </label>
            <textarea
              id="notes"
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything else you'd like us to know about your community..."
              className="w-full px-4 py-3 rounded-xl border border-neutral-300 bg-white text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent resize-none"
            />
          </div>

          {/* Error message */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Submit button */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full px-6 py-3.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-colors"
          >
            {isSubmitting ? "Submitting..." : "Submit proposal"}
          </button>
        </form>
      </div>
    </div>
  );
}
