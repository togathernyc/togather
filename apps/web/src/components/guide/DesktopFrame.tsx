import type { ReactNode } from "react";

/**
 * A lightweight desktop-browser frame, the wide-screen sibling of PhoneFrame.
 * Purely presentational — it draws a rounded bezel, a top chrome bar with three
 * traffic-light dots and a centered pill URL field, and a wide content area.
 * Used to wrap code-reconstructed desktop app screens (e.g. the roster grid)
 * so they read as "in the app on a big screen".
 */
export function DesktopFrame({
  children,
  url = "togather.nyc",
}: {
  children: ReactNode;
  /** URL shown in the centered address pill, e.g. "togather.nyc/rostering". */
  url?: string;
}) {
  return (
    <div className="w-full bg-neutral-900 rounded-[1.25rem] p-2.5 shadow-xl shadow-neutral-900/15">
      {/* Top chrome bar */}
      <div className="relative flex items-center px-3 py-2.5">
        {/* Traffic-light dots */}
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-red-400" />
          <span className="h-3 w-3 rounded-full bg-amber-400" />
          <span className="h-3 w-3 rounded-full bg-green-400" />
        </div>
        {/* Centered URL pill */}
        <div className="absolute left-1/2 -translate-x-1/2 flex w-1/2 max-w-xs items-center justify-center gap-1.5 rounded-md bg-neutral-700/70 px-3 py-1 text-[11px] font-medium text-neutral-200">
          <svg
            className="h-3 w-3 flex-shrink-0 text-neutral-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span className="truncate">{url}</span>
        </div>
      </div>
      {/* Content area — wide 16:10-ish aspect. */}
      <div
        className="bg-white rounded-[0.9rem] overflow-hidden"
        style={{ aspectRatio: "16 / 10" }}
      >
        <div className="h-full w-full overflow-auto no-scrollbar">
          {children}
        </div>
      </div>
    </div>
  );
}
