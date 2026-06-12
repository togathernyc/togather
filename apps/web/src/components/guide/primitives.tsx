import type { ReactNode } from "react";

/**
 * Shared building blocks for guide posts. Keeping these in one place means every
 * post in the series looks consistent and a styling tweak lands everywhere.
 */

/** Large intro paragraph under the post title. */
export function Lead({ children }: { children: ReactNode }) {
  return (
    <p className="text-lg text-neutral-600 leading-relaxed mb-10">{children}</p>
  );
}

/** A titled content section with an anchor id (used by the table of contents). */
export function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-14 scroll-mt-24" id={id}>
      <h2 className="text-2xl font-bold text-neutral-900 mb-4">
        <a href={`#${id}`} className="group inline-flex items-center gap-2">
          {title}
          <span className="text-neutral-300 opacity-0 group-hover:opacity-100 text-lg">
            #
          </span>
        </a>
      </h2>
      <div className="space-y-4 text-neutral-600 leading-relaxed">{children}</div>
    </section>
  );
}

/** A standard body paragraph. */
export function P({ children }: { children: ReactNode }) {
  return <p className="text-neutral-600 leading-relaxed">{children}</p>;
}

type CalloutTone = "tip" | "note" | "warn";

const calloutStyles: Record<
  CalloutTone,
  { box: string; badge: string; label: string }
> = {
  tip: {
    box: "bg-accent-400/10 border-accent-500/30",
    badge: "bg-accent-600 text-white",
    label: "Tip",
  },
  note: {
    box: "bg-primary-50 border-primary-200",
    badge: "bg-primary-700 text-white",
    label: "Note",
  },
  warn: {
    box: "bg-amber-50 border-amber-200",
    badge: "bg-amber-600 text-white",
    label: "Heads up",
  },
};

/** Highlighted aside for tips, notes, and warnings. */
export function Callout({
  tone = "note",
  title,
  children,
}: {
  tone?: CalloutTone;
  title?: string;
  children: ReactNode;
}) {
  const s = calloutStyles[tone];
  return (
    <div className={`rounded-2xl border ${s.box} p-5 my-6`}>
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${s.badge}`}
        >
          {s.label}
        </span>
        {title && (
          <span className="font-semibold text-neutral-900">{title}</span>
        )}
      </div>
      <div className="text-neutral-700 leading-relaxed space-y-2">{children}</div>
    </div>
  );
}

/** Numbered, ordered list of steps. */
export function Steps({ children }: { children: ReactNode }) {
  return <ol className="space-y-4 my-6 counter-reset-step">{children}</ol>;
}

/** A single numbered step. Pass the 1-based `n`. */
export function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="flex-shrink-0 w-7 h-7 rounded-full bg-neutral-900 text-white text-sm font-semibold flex items-center justify-center">
        {n}
      </span>
      <div className="flex-1 text-neutral-600 leading-relaxed pt-0.5">
        {children}
      </div>
    </li>
  );
}

/** Inline key term / UI label rendered like a pill. */
export function Term({ children }: { children: ReactNode }) {
  return (
    <span className="font-medium text-neutral-800 bg-neutral-100 border border-neutral-200 rounded px-1.5 py-0.5 text-[0.95em]">
      {children}
    </span>
  );
}

/** A deep link button into the Togather app. */
export function DeepLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-medium text-sm transition-colors no-underline"
    >
      <svg
        className="w-4 h-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <polyline points="15 3 21 3 21 9" />
        <line x1="10" y1="14" x2="21" y2="3" />
      </svg>
      {children}
    </a>
  );
}

/**
 * A figure with a caption. Renders a code-reconstructed UI mockup (`children`)
 * by default. When a real screenshot is available, pass `src` and the image is
 * shown instead — no other changes needed, so mockups are swappable for
 * screenshots over time.
 */
export function Figure({
  caption,
  src,
  alt,
  children,
}: {
  caption?: string;
  src?: string;
  alt?: string;
  children?: ReactNode;
}) {
  return (
    <figure className="my-8">
      <div className="rounded-2xl border border-neutral-200 bg-gradient-to-b from-neutral-50 to-neutral-100 p-5 sm:p-8 overflow-hidden flex justify-center">
        {src ? (
          <img
            src={src}
            alt={alt ?? caption ?? ""}
            className="mx-auto rounded-2xl shadow-sm max-w-full"
          />
        ) : (
          children
        )}
      </div>
      {caption && (
        <figcaption className="mt-3 text-center text-sm text-neutral-500">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
