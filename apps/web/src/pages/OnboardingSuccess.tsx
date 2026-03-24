import { Link, useSearchParams } from "react-router-dom";

function CheckCircle() {
  return (
    <svg
      className="w-20 h-20 text-green-600"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="9 12 11.5 14.5 15.5 9.5" />
    </svg>
  );
}

function AppleIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );
}

function PlayStoreIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M3.609 1.814L13.792 12 3.61 22.186a.996.996 0 0 1-.61-.92V2.734a1 1 0 0 1 .609-.92zm10.89 10.893l2.302 2.302-10.937 6.333 8.635-8.635zm3.199-3.199l2.302 2.302a1 1 0 0 1 0 1.38l-2.302 2.302L15.168 12l2.53-2.492zM5.864 2.658L16.8 8.99l-2.302 2.302-8.634-8.634z" />
    </svg>
  );
}

export default function OnboardingSuccess() {
  const [searchParams] = useSearchParams();
  // session_id is available via searchParams.get("session_id") if needed
  void searchParams;

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-primary-100 flex items-center justify-center px-4">
      <div className="w-full max-w-lg">
        {/* Card */}
        <div className="bg-white rounded-2xl shadow-lg shadow-neutral-200/50 border border-neutral-200/60 p-8 md:p-10">
          {/* Success icon */}
          <div className="flex justify-center mb-6">
            <div className="w-24 h-24 bg-green-50 rounded-full flex items-center justify-center border border-green-100">
              <CheckCircle />
            </div>
          </div>

          {/* Heading */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-neutral-900 mb-3">
              Welcome to Togather!
            </h1>
            <p className="text-neutral-600 text-base leading-relaxed">
              Your community is now active. You're the{" "}
              <span className="font-semibold text-neutral-800">
                Primary Admin
              </span>
              .
            </p>
          </div>

          {/* Admin info card */}
          <div className="bg-neutral-50 rounded-xl border border-neutral-200 p-5 mb-8">
            <h2 className="text-sm font-semibold text-neutral-800 uppercase tracking-wide mb-3">
              What you can do as Primary Admin
            </h2>
            <ul className="space-y-2.5 text-sm text-neutral-600">
              <li className="flex items-start gap-2.5">
                <span className="mt-0.5 flex-shrink-0 w-4 h-4 rounded-full bg-green-100 border border-green-200 flex items-center justify-center">
                  <svg
                    className="w-2.5 h-2.5 text-green-700"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                Promote and demote other admins
              </li>
              <li className="flex items-start gap-2.5">
                <span className="mt-0.5 flex-shrink-0 w-4 h-4 rounded-full bg-green-100 border border-green-200 flex items-center justify-center">
                  <svg
                    className="w-2.5 h-2.5 text-green-700"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                Manage community settings and billing
              </li>
              <li className="flex items-start gap-2.5">
                <span className="mt-0.5 flex-shrink-0 w-4 h-4 rounded-full bg-green-100 border border-green-200 flex items-center justify-center">
                  <svg
                    className="w-2.5 h-2.5 text-green-700"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                Transfer ownership if needed
              </li>
            </ul>
          </div>

          {/* Note about app configuration */}
          <div className="bg-primary-50 rounded-xl border border-primary-100 p-4 mb-8">
            <p className="text-sm text-neutral-700 leading-relaxed">
              <span className="font-medium text-neutral-800">Next step:</span>{" "}
              Community configuration (group types, landing page, etc.) happens
              in the app's Admin tab. Download the app to get started.
            </p>
          </div>

          {/* Download buttons */}
          <div className="space-y-3">
            <a
              href="https://apps.apple.com/app/togather"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2.5 w-full rounded-xl bg-neutral-900 hover:bg-neutral-800 px-5 py-3 text-sm font-semibold text-white transition-colors"
            >
              <AppleIcon className="w-5 h-5" />
              Download for iPhone
            </a>
            <a
              href="https://play.google.com/store/apps/details?id=com.togather"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2.5 w-full rounded-xl bg-neutral-900 hover:bg-neutral-800 px-5 py-3 text-sm font-semibold text-white transition-colors"
            >
              <PlayStoreIcon className="w-5 h-5" />
              Download for Android
            </a>
          </div>
        </div>

        {/* Footer link */}
        <p className="text-center text-sm text-neutral-400 mt-6">
          <Link to="/" className="hover:text-neutral-600 underline underline-offset-2">
            Back to Togather.com
          </Link>
        </p>
      </div>
    </div>
  );
}
