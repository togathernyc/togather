import { useState, useEffect } from "react";
import { Link } from "react-router-dom";

// Closed-testing links. The opt-in URL is where a tester enrolls their Google
// account ("Become a tester"); the store URL only works once they're enrolled
// and access has propagated. The group is the tester allowlist.
const TESTERS_GROUP_URL = "https://groups.google.com/a/supa.media/g/togather-testers";
const PLAY_OPT_IN_URL = "https://play.google.com/apps/testing/app.gatherful.mobile";
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=app.gatherful.mobile";

const R2_BASE = `${import.meta.env.VITE_IMAGE_CDN_URL || "https://images.togather.nyc"}/releases/android`;
const STAGING_APK_URL = `${R2_BASE}/staging/togather-staging-latest.apk`;

/**
 * Android install page.
 *
 * Production (`/android`) is invite-only Google Play closed testing — no
 * sideloaded APK. Staging (`/android-staging`) is internal-only and still
 * distributes the staging APK from R2. The Cloudflare worker rewrites
 * /android → /android-staging on the staging environment.
 */
export function AndroidDownload({ variant = "production" }: { variant?: "production" | "staging" }) {
  return variant === "staging" ? <StagingSideloadPage /> : <ClosedTestingPage />;
}

function BackToHome() {
  return (
    <Link
      to="/"
      className="inline-flex items-center gap-2 text-neutral-600 hover:text-neutral-900 mb-10"
    >
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M19 12H5M12 19l-7-7 7-7" />
      </svg>
      Back to Home
    </Link>
  );
}

function AndroidIcon() {
  return (
    <div className="w-20 h-20 bg-[#3ddc84]/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
      <svg className="w-10 h-10 text-[#3ddc84]" viewBox="0 0 24 24" fill="currentColor">
        <path d="M17.6 9.48l1.84-3.18c.16-.31.04-.69-.27-.86a.64.64 0 0 0-.87.26l-1.88 3.24a11.43 11.43 0 0 0-8.84 0L5.73 5.7a.64.64 0 0 0-.87-.26c-.31.17-.43.55-.27.86L6.43 9.48A10.28 10.28 0 0 0 1.58 17h20.84A10.28 10.28 0 0 0 17.6 9.48zM7 14.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm10 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2z" />
      </svg>
    </div>
  );
}

// ── Production: Google Play closed testing ──────────────────────────────────

function ClosedTestingPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-xl mx-auto px-6 py-12">
        <BackToHome />

        <div className="text-center mb-10">
          <AndroidIcon />
          <h1 className="text-3xl font-bold text-neutral-900 mb-2">
            Togather for Android
          </h1>
          <span className="inline-block text-sm font-semibold text-[#1f9c5c] bg-[#3ddc84]/10 px-3 py-1 rounded-full">
            Closed testing
          </span>
          <p className="text-neutral-500 mt-4">
            Togather is in invite-only testing on Google Play. You can&rsquo;t find it
            by searching the Play Store yet &mdash; follow these 3 steps to get it.
          </p>
        </div>

        <ol className="space-y-4 mb-8">
          <StepCard
            number={1}
            title="Join the testers group"
            body="Use the same Google account you're signed into on your phone."
            cta="Join the testers group"
            href={TESTERS_GROUP_URL}
          />
          <StepCard
            number={2}
            title="Become a tester"
            body="Open the opt-in link and tap “Become a tester” to enroll your account."
            cta="Become a tester"
            href={PLAY_OPT_IN_URL}
          />
          <StepCard
            number={3}
            title="Install Togather"
            body="Install from Google Play. If it says “not available” or “item not found,” your tester access is still activating — wait about 30 minutes and try again."
            cta="Get it on Google Play"
            href={PLAY_STORE_URL}
          />
        </ol>

        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-800">
          <p>
            <strong>Why can&rsquo;t I search for it?</strong> Togather is in Google&rsquo;s
            closed testing program, so it&rsquo;s only visible to approved testers
            through these links &mdash; not in public Play Store search. Once we pass
            Google&rsquo;s testing requirements, it&rsquo;ll be available to everyone.
          </p>
        </div>
      </div>
    </div>
  );
}

function StepCard({
  number,
  title,
  body,
  cta,
  href,
}: {
  number: number;
  title: string;
  body: string;
  cta: string;
  href: string;
}) {
  return (
    <li className="bg-neutral-50 rounded-2xl border border-neutral-200 p-5">
      <div className="flex gap-4">
        <span className="flex-shrink-0 w-8 h-8 bg-neutral-900 text-white rounded-full flex items-center justify-center text-sm font-semibold">
          {number}
        </span>
        <div className="flex-1">
          <h2 className="text-base font-semibold text-neutral-900 mb-1">{title}</h2>
          <p className="text-neutral-500 text-sm mb-4">{body}</p>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-neutral-900 text-white text-sm font-medium rounded-xl hover:bg-neutral-800 transition-colors"
          >
            {cta}
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </a>
        </div>
      </div>
    </li>
  );
}

// ── Staging: internal-only sideloaded APK from R2 ───────────────────────────

interface ManifestData {
  version: string;
  releaseDate: string;
  fileSize: number;
  downloadUrl: string;
  latestUrl: string;
  minSupportedVersion: string;
}

type FetchState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "success"; manifest: ManifestData };

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(isoDate: string): string {
  try {
    return new Date(isoDate).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

function StagingSideloadPage() {
  const [state, setState] = useState<FetchState>({ status: "loading" });

  const manifestUrl = `${R2_BASE}/staging/manifest.json`;

  useEffect(() => {
    let stale = false;

    fetch(manifestUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: ManifestData) => {
        if (!stale) setState({ status: "success", manifest: data });
      })
      .catch(() => {
        if (!stale) setState({ status: "error" });
      });

    return () => { stale = true; };
  }, [manifestUrl]);

  const handleDownload = () => {
    if (state.status === "success") {
      window.location.href = state.manifest.downloadUrl;
    }
  };

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-xl mx-auto px-6 py-12">
        <BackToHome />

        <div className="text-center mb-10">
          <AndroidIcon />
          <h1 className="text-3xl font-bold text-neutral-900 mb-2">
            Download Togather for Android
          </h1>
          <p className="text-neutral-500">Staging build for testing</p>
        </div>

        <div className="bg-neutral-50 rounded-2xl border border-neutral-200 p-6 mb-8">
          {state.status === "loading" && (
            <div className="text-center py-8">
              <div className="w-8 h-8 border-2 border-neutral-300 border-t-neutral-600 rounded-full animate-spin mx-auto mb-3" />
              <p className="text-neutral-400 text-sm">Loading release info...</p>
            </div>
          )}

          {state.status === "error" && (
            <div className="text-center py-6">
              <p className="text-neutral-600 mb-4">Could not load release information.</p>
              <a
                href={STAGING_APK_URL}
                className="inline-flex items-center gap-2 px-6 py-3 bg-neutral-900 text-white font-medium rounded-xl hover:bg-neutral-800 transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download Latest APK
              </a>
            </div>
          )}

          {state.status === "success" && (
            <>
              <div className="flex items-center justify-between mb-5 text-sm">
                <div>
                  <span className="text-neutral-400">Version</span>
                  <p className="text-neutral-900 font-semibold">{state.manifest.version}</p>
                </div>
                {state.manifest.releaseDate && (
                  <div className="text-right">
                    <span className="text-neutral-400">Released</span>
                    <p className="text-neutral-900 font-medium">
                      {formatDate(state.manifest.releaseDate)}
                    </p>
                  </div>
                )}
              </div>

              {state.manifest.fileSize > 0 && (
                <p className="text-neutral-400 text-sm mb-5">
                  File size: {formatFileSize(state.manifest.fileSize)}
                </p>
              )}

              <button
                onClick={handleDownload}
                className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-neutral-900 text-white font-medium rounded-xl hover:bg-neutral-800 transition-colors cursor-pointer"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download APK
              </button>
            </>
          )}
        </div>

        <div className="mb-8">
          <h2 className="text-lg font-semibold text-neutral-900 mb-4">How to install</h2>
          <ol className="space-y-3 text-neutral-600 text-sm">
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-neutral-100 rounded-full flex items-center justify-center text-xs font-semibold text-neutral-500">1</span>
              <span>
                Tap <strong>Download APK</strong> above. Your browser may show a warning — tap{" "}
                <strong>Download anyway</strong>.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-neutral-100 rounded-full flex items-center justify-center text-xs font-semibold text-neutral-500">2</span>
              <span>
                Open the downloaded file. If prompted, enable{" "}
                <strong>Install from unknown sources</strong> for your browser in Settings.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-neutral-100 rounded-full flex items-center justify-center text-xs font-semibold text-neutral-500">3</span>
              <span>Tap <strong>Install</strong> and open Togather once installation is complete.</span>
            </li>
          </ol>
        </div>

        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-800">
          <p>
            <strong>About updates:</strong> Most updates are delivered automatically when
            you open the app. You only need to download a new APK when there is a major
            update that requires reinstallation.
          </p>
        </div>
      </div>
    </div>
  );
}
