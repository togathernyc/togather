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
      {/*
       * The screen holds a true iPhone proportion (9 : 19.5, the aspect ratio
       * of the iPhone 12 through 16 display). Content scrolls inside it like a
       * real device, so the frame always reads as an actual phone.
       */}
      <div
        className="bg-white rounded-[2rem] overflow-hidden flex flex-col"
        style={{ aspectRatio: "9 / 19.5" }}
      >
        {/* Status bar */}
        <div className="h-9 flex-shrink-0 flex items-end justify-between px-5 pb-1.5 text-[10px] font-semibold text-neutral-700 bg-white">
          <span>9:41</span>
          <span className="flex items-center gap-1">
            <span>5G</span>
            <span className="inline-block w-5 h-2.5 rounded-sm border border-neutral-400" />
          </span>
        </div>
        {title && (
          <div className="px-4 py-3 flex-shrink-0 border-b border-neutral-100 text-center text-sm font-semibold text-neutral-900">
            {title}
          </div>
        )}
        {/* Screen content — scrolls within the fixed-ratio screen. */}
        <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
          {children}
        </div>
        {/* Home indicator. */}
        <div className="flex-shrink-0 flex justify-center py-2">
          <span className="w-28 h-1 rounded-full bg-neutral-300" />
        </div>
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
