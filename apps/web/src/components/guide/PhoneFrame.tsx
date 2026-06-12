import type { ReactNode } from "react";

/**
 * A lightweight phone-device frame used to wrap code-reconstructed app screens
 * in guide posts. Purely presentational — it draws a rounded bezel, a notch,
 * and an optional status/header bar so reconstructed UI reads as "in the app".
 */
export function PhoneFrame({
  children,
  title,
  width = 300,
}: {
  children: ReactNode;
  /** Optional screen header title (the app's top bar). */
  title?: string;
  width?: number;
}) {
  return (
    <div
      className="relative bg-neutral-900 rounded-[2.5rem] p-2.5 shadow-xl shadow-neutral-900/15"
      style={{ width }}
    >
      {/* Notch */}
      <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-10 w-24 h-5 bg-neutral-900 rounded-b-2xl" />
      <div className="bg-white rounded-[2rem] overflow-hidden">
        {/* Status bar */}
        <div className="h-9 flex items-end justify-between px-5 pb-1.5 text-[10px] font-semibold text-neutral-700 bg-white">
          <span>9:41</span>
          <span className="flex items-center gap-1">
            <span>5G</span>
            <span className="inline-block w-5 h-2.5 rounded-sm border border-neutral-400" />
          </span>
        </div>
        {title && (
          <div className="px-4 py-3 border-b border-neutral-100 text-center text-sm font-semibold text-neutral-900">
            {title}
          </div>
        )}
        <div className="min-h-[1px]">{children}</div>
      </div>
    </div>
  );
}

/** A small avatar bubble used in channel/member mockups. */
export function Avatar({
  label,
  color = "bg-primary-400",
}: {
  label: string;
  color?: string;
}) {
  return (
    <span
      className={`inline-flex items-center justify-center w-8 h-8 rounded-full ${color} text-white text-xs font-semibold flex-shrink-0`}
    >
      {label}
    </span>
  );
}
