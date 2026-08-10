import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { getGuide, getGuideNeighbors } from "../../guides/registry";

/** A table-of-contents entry — matches a <Section id=...> in the post body. */
export type TocItem = { id: string; label: string };

/**
 * Shared chrome for every guide post: back link, series eyebrow, title block,
 * a sticky table of contents on wide screens, and previous/next navigation
 * pulled from the guide registry.
 */
export function GuideLayout({
  slug,
  toc,
  children,
}: {
  slug: string;
  toc: TocItem[];
  children: ReactNode;
}) {
  const guide = getGuide(slug);
  const { prev, next } = getGuideNeighbors(slug);

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-5xl mx-auto px-6 py-12">
        <Link
          to="/guides"
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
          All guides
        </Link>

        {/* Header */}
        <header className="mb-10">
          {guide && (
            <div className="text-sm font-semibold text-primary-600 uppercase tracking-wide mb-3">
              {guide.series}
            </div>
          )}
          <h1 className="text-4xl font-bold text-neutral-900 mb-3">
            {guide?.title}
          </h1>
          {guide && (
            <p className="text-neutral-500 text-sm">{guide.readMinutes} min read</p>
          )}
        </header>

        <div className="flex flex-col lg:flex-row gap-12">
          {/* Body */}
          <article className="flex-1 min-w-0">{children}</article>

          {/* Table of contents */}
          {toc.length > 0 && (
            <aside className="lg:w-56 flex-shrink-0 order-first lg:order-last">
              <nav className="lg:sticky lg:top-12">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-3">
                  On this page
                </h2>
                <ul className="space-y-2 text-sm border-l border-neutral-200">
                  {toc.map((item) => (
                    <li key={item.id}>
                      <a
                        href={`#${item.id}`}
                        className="block pl-4 -ml-px border-l-2 border-transparent text-neutral-500 hover:text-neutral-900 hover:border-primary-400"
                      >
                        {item.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            </aside>
          )}
        </div>

        {/* Prev / next */}
        <nav className="mt-16 pt-8 border-t border-neutral-200 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {prev ? (
            <Link
              to={`/guides/${prev.slug}`}
              className="group rounded-2xl border border-neutral-200 p-5 hover:border-primary-300 hover:bg-primary-50/40 transition-colors"
            >
              <div className="text-xs text-neutral-400 mb-1">← Previous</div>
              <div className="font-semibold text-neutral-900 group-hover:text-primary-700">
                {prev.title}
              </div>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link
              to={`/guides/${next.slug}`}
              className="group rounded-2xl border border-neutral-200 p-5 text-right hover:border-primary-300 hover:bg-primary-50/40 transition-colors"
            >
              <div className="text-xs text-neutral-400 mb-1">Next →</div>
              <div className="font-semibold text-neutral-900 group-hover:text-primary-700">
                {next.title}
              </div>
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </div>
    </div>
  );
}
