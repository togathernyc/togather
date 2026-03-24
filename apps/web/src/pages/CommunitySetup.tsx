import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";

// ============================================================================
// Helpers
// ============================================================================

/** Convert a community name into a URL-safe slug. */
function nameToSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Validate a slug: lowercase alphanumeric + hyphens, no leading/trailing hyphens. */
function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length >= 2;
}

/** Validate a hex color string. */
function isValidHex(hex: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(hex);
}

// ============================================================================
// Icons
// ============================================================================

function IconLoader({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      className={`${className} animate-spin`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

function IconAlertCircle({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function IconCheckCircle({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

// ============================================================================
// Color Input Component
// ============================================================================

function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [textValue, setTextValue] = useState(value);
  const valid = isValidHex(textValue);

  // Sync external changes
  useEffect(() => {
    setTextValue(value);
  }, [value]);

  function handleTextChange(newValue: string) {
    // Auto-add # prefix if missing
    let normalized = newValue;
    if (normalized && !normalized.startsWith("#")) {
      normalized = "#" + normalized;
    }
    setTextValue(normalized);
    if (isValidHex(normalized)) {
      onChange(normalized);
    }
  }

  return (
    <div>
      <label className="block text-sm font-medium text-neutral-700 mb-1.5">
        {label}
      </label>
      <div className="flex items-center gap-3">
        {/* Native color picker */}
        <input
          type="color"
          value={valid ? textValue : "#000000"}
          onChange={(e) => {
            const hex = e.target.value.toUpperCase();
            setTextValue(hex);
            onChange(hex);
          }}
          className="w-10 h-10 rounded-lg border border-neutral-200 cursor-pointer p-0.5 bg-white"
        />
        {/* Text input for hex value */}
        <div className="flex-1 relative">
          <input
            type="text"
            value={textValue}
            onChange={(e) => handleTextChange(e.target.value)}
            placeholder="#3B82F6"
            maxLength={7}
            className={`w-full px-3 py-2.5 border rounded-xl text-sm font-mono ${
              textValue && !valid
                ? "border-red-300 focus:ring-red-500 focus:border-red-500"
                : "border-neutral-200 focus:ring-neutral-500 focus:border-neutral-500"
            } focus:outline-none focus:ring-2 focus:ring-offset-0`}
          />
          {textValue && !valid && (
            <p className="text-xs text-red-500 mt-1">
              Enter a valid hex color (e.g. #3B82F6)
            </p>
          )}
        </div>
        {/* Preview swatch */}
        {valid && (
          <div
            className="w-10 h-10 rounded-lg border border-neutral-200 flex-shrink-0"
            style={{ backgroundColor: textValue }}
          />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function CommunitySetup() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  // Load proposal via Convex query
  const data = useQuery(
    api.functions.proposals.getBySetupToken,
    token ? { setupToken: token } : "skip"
  );

  // Convex mutations/actions
  const completeSetup = useMutation(api.functions.proposals.completeSetup);
  const createCheckoutSession = useAction(
    api.functions.billing.createCheckoutSession
  );

  // Form state — initialize from proposal data
  const proposalName = data?.proposal?.communityName ?? "";
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#3B82F6");
  const [secondaryColor, setSecondaryColor] = useState("#1E293B");
  const [initialized, setInitialized] = useState(false);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [submissionPhase, setSubmissionPhase] = useState<
    "idle" | "setup" | "checkout" | "redirecting"
  >("idle");
  const [error, setError] = useState<string | null>(null);

  // Pre-fill form from proposal data (only once)
  if (proposalName && !initialized) {
    setName(proposalName);
    setSlug(nameToSlug(proposalName));
    setInitialized(true);
  }

  // Auto-generate slug from name (unless manually edited)
  const handleNameChange = useCallback(
    (newName: string) => {
      setName(newName);
      if (!slugManuallyEdited) {
        setSlug(nameToSlug(newName));
      }
    },
    [slugManuallyEdited]
  );

  const handleSlugChange = useCallback((newSlug: string) => {
    // Enforce slug format as the user types
    const sanitized = newSlug
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-");
    setSlug(sanitized);
    setSlugManuallyEdited(true);
  }, []);

  // Validate form
  const slugValid = isValidSlug(slug);
  const primaryColorValid = isValidHex(primaryColor);
  const secondaryColorValid = isValidHex(secondaryColor);
  const formValid =
    name.trim().length > 0 &&
    slugValid &&
    primaryColorValid &&
    secondaryColorValid;

  // Handle form submission
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !formValid || submitting) return;

    setError(null);
    setSubmitting(true);

    try {
      // Phase 1: Complete the community setup
      setSubmissionPhase("setup");
      await completeSetup({
        setupToken: token,
        slug,
        name: name.trim(),
        description: description.trim() || undefined,
        primaryColor,
        secondaryColor,
      });

      // Phase 2: Create Stripe checkout session
      setSubmissionPhase("checkout");
      const result = await createCheckoutSession({
        setupToken: token,
      });

      // Phase 3: Redirect to Stripe
      setSubmissionPhase("redirecting");
      window.location.href = result.url;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong";

      // Surface user-friendly error messages
      if (message.includes("Slug is already taken")) {
        setError(
          "That URL slug is already taken. Please choose a different one."
        );
      } else if (message.includes("Setup has already been completed")) {
        setError(
          "This community has already been set up. If you need to make changes, please contact support."
        );
      } else {
        setError(message);
      }

      setSubmitting(false);
      setSubmissionPhase("idle");
    }
  }

  // Status text for the submit button
  function getSubmitLabel(): string {
    switch (submissionPhase) {
      case "setup":
        return "Setting up your community...";
      case "checkout":
        return "Preparing payment...";
      case "redirecting":
        return "Redirecting to payment...";
      default:
        return "Continue to Payment";
    }
  }

  // ============================================================================
  // Error States
  // ============================================================================

  // No token in URL
  if (!token) {
    return (
      <PageContainer>
        <ErrorCard
          title="Missing setup token"
          message="This page requires a valid setup link. Please check your email for the community setup invitation."
        />
      </PageContainer>
    );
  }

  // Loading
  if (data === undefined) {
    return (
      <PageContainer>
        <div className="flex flex-col items-center justify-center py-20">
          <IconLoader className="w-8 h-8 text-neutral-400" />
          <p className="mt-4 text-neutral-500">Loading your community setup...</p>
        </div>
      </PageContainer>
    );
  }

  // Proposal not found
  if (data === null) {
    return (
      <PageContainer>
        <ErrorCard
          title="Setup link not found"
          message="This setup link is invalid or has expired. Please contact support if you believe this is an error."
        />
      </PageContainer>
    );
  }

  // Setup already completed
  if (data.proposal.setupCompletedAt !== undefined) {
    return (
      <PageContainer>
        <div className="max-w-lg mx-auto text-center py-16">
          <div className="w-16 h-16 bg-accent-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <IconCheckCircle className="w-8 h-8 text-accent-500" />
          </div>
          <h1 className="text-2xl font-bold text-neutral-900 mb-3">
            Setup already completed
          </h1>
          <p className="text-neutral-600">
            This community has already been set up
            {data.community?.name ? (
              <>
                {" "}
                as <strong>{data.community.name}</strong>
              </>
            ) : null}
            . If you need to make changes or complete payment, please contact
            support.
          </p>
        </div>
      </PageContainer>
    );
  }

  // ============================================================================
  // Setup Form
  // ============================================================================

  return (
    <PageContainer>
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="flex items-center justify-center gap-2 mb-4">
            <img
              src="/images/togather-logo.png"
              alt="Togather logo"
              className="h-8 w-auto object-contain"
            />
            <span className="text-xl font-semibold text-neutral-800">
              Togather
            </span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-neutral-900 mb-3">
            Set up your community
          </h1>
          <p className="text-neutral-600 text-lg">
            Configure your community's profile and branding, then continue to
            payment to go live.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-8">
          {/* ---- Community Details ---- */}
          <section className="bg-white rounded-2xl border border-neutral-200 p-6 md:p-8 space-y-6">
            <h2 className="text-lg font-semibold text-neutral-900">
              Community Details
            </h2>

            {/* Community Name */}
            <div>
              <label
                htmlFor="name"
                className="block text-sm font-medium text-neutral-700 mb-1.5"
              >
                Community name
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="My Community"
                required
                className="w-full px-4 py-2.5 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-neutral-500 focus:border-neutral-500 focus:ring-offset-0"
              />
            </div>

            {/* URL Slug */}
            <div>
              <label
                htmlFor="slug"
                className="block text-sm font-medium text-neutral-700 mb-1.5"
              >
                URL slug
              </label>
              <input
                id="slug"
                type="text"
                value={slug}
                onChange={(e) => handleSlugChange(e.target.value)}
                placeholder="my-community"
                required
                className={`w-full px-4 py-2.5 border rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-offset-0 ${
                  slug && !slugValid
                    ? "border-red-300 focus:ring-red-500 focus:border-red-500"
                    : "border-neutral-200 focus:ring-neutral-500 focus:border-neutral-500"
                }`}
              />
              {/* Live preview */}
              <p className="mt-1.5 text-sm text-neutral-500">
                Your community will be at{" "}
                <span className="font-mono text-neutral-700">
                  togather.app/{slug || "your-slug"}
                </span>
              </p>
              {slug && !slugValid && (
                <p className="mt-1 text-xs text-red-500">
                  Slug must be at least 2 characters, lowercase letters, numbers,
                  and hyphens only.
                </p>
              )}
            </div>

            {/* Description */}
            <div>
              <label
                htmlFor="description"
                className="block text-sm font-medium text-neutral-700 mb-1.5"
              >
                Description{" "}
                <span className="text-neutral-400 font-normal">(optional)</span>
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Tell people what your community is about..."
                rows={3}
                className="w-full px-4 py-2.5 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-neutral-500 focus:border-neutral-500 focus:ring-offset-0 resize-vertical"
              />
            </div>
          </section>

          {/* ---- Branding ---- */}
          <section className="bg-white rounded-2xl border border-neutral-200 p-6 md:p-8 space-y-6">
            <h2 className="text-lg font-semibold text-neutral-900">Branding</h2>

            {/* Primary Color */}
            <ColorInput
              label="Primary color"
              value={primaryColor}
              onChange={setPrimaryColor}
            />

            {/* Secondary Color */}
            <ColorInput
              label="Secondary color"
              value={secondaryColor}
              onChange={setSecondaryColor}
            />

            {/* Color Preview */}
            {primaryColorValid && secondaryColorValid && (
              <div>
                <p className="text-sm font-medium text-neutral-700 mb-2">
                  Preview
                </p>
                <div className="flex gap-3">
                  <div
                    className="flex-1 h-16 rounded-xl flex items-center justify-center"
                    style={{ backgroundColor: primaryColor }}
                  >
                    <span
                      className="text-sm font-medium"
                      style={{ color: secondaryColor }}
                    >
                      Primary
                    </span>
                  </div>
                  <div
                    className="flex-1 h-16 rounded-xl flex items-center justify-center"
                    style={{ backgroundColor: secondaryColor }}
                  >
                    <span
                      className="text-sm font-medium"
                      style={{ color: primaryColor }}
                    >
                      Secondary
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Logo */}
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                Logo
              </label>
              <div className="flex items-center gap-3 px-4 py-3 bg-neutral-50 rounded-xl border border-dashed border-neutral-300">
                <div className="w-10 h-10 bg-neutral-200 rounded-lg flex items-center justify-center flex-shrink-0">
                  <svg
                    className="w-5 h-5 text-neutral-400"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                </div>
                <p className="text-sm text-neutral-500">
                  Logo upload coming soon. You can add your logo after setup is
                  complete.
                </p>
              </div>
            </div>
          </section>

          {/* ---- Error Message ---- */}
          {error && (
            <div className="flex items-start gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl">
              <IconAlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* ---- Submit Button ---- */}
          <button
            type="submit"
            disabled={!formValid || submitting}
            className={`w-full py-3.5 px-6 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2 ${
              formValid && !submitting
                ? "bg-neutral-900 text-white hover:bg-neutral-800 cursor-pointer"
                : "bg-neutral-200 text-neutral-400 cursor-not-allowed"
            }`}
          >
            {submitting && <IconLoader className="w-4 h-4" />}
            {getSubmitLabel()}
          </button>

          {/* Stripe note */}
          <p className="text-center text-xs text-neutral-400">
            You will be redirected to Stripe to complete payment. Your community
            will go live after payment is confirmed.
          </p>
        </form>
      </div>
    </PageContainer>
  );
}

// ============================================================================
// Layout Wrappers
// ============================================================================

function PageContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="px-4 py-12 md:py-20">{children}</div>
    </div>
  );
}

function ErrorCard({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div className="max-w-lg mx-auto text-center py-16">
      <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
        <IconAlertCircle className="w-8 h-8 text-red-500" />
      </div>
      <h1 className="text-2xl font-bold text-neutral-900 mb-3">{title}</h1>
      <p className="text-neutral-600">{message}</p>
      <a
        href="/"
        className="inline-block mt-6 px-5 py-2.5 text-sm font-medium text-neutral-700 hover:text-neutral-900 border border-neutral-200 rounded-xl hover:border-neutral-300"
      >
        Back to home
      </a>
    </div>
  );
}
