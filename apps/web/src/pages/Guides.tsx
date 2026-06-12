import { Link } from "react-router-dom";
import { guides, CHURCH_ONBOARDING_SERIES } from "../guides/registry";

/**
 * The /guides hub. Lists every guide grouped by series. Cards are driven by the
 * registry, so adding a post there makes it appear here automatically.
 */
export function Guides() {
  const churchGuides = guides.filter(
    (g) => g.series === CHURCH_ONBOARDING_SERIES,
  );

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-6 py-12">
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

        <h1 className="text-4xl font-bold text-neutral-900 mb-3">Guides</h1>
        <p className="text-lg text-neutral-600 mb-12 leading-relaxed max-w-2xl">
          Step-by-step help for getting the most out of Togather. Start with the
          church onboarding series below — it walks you from creating your
          community to enabling prayer.
        </p>

        {/* Church onboarding series */}
        <section className="mb-12">
          <div className="flex items-center gap-3 mb-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-primary-600">
              {CHURCH_ONBOARDING_SERIES}
            </h2>
            <div className="flex-1 h-px bg-neutral-200" />
            <span className="text-sm text-neutral-400">
              {churchGuides.length} guides
            </span>
          </div>

          <ol className="space-y-3">
            {churchGuides.map((g, i) => (
              <li key={g.slug}>
                <Link
                  to={`/guides/${g.slug}`}
                  className="group flex items-start gap-4 rounded-2xl border border-neutral-200 p-5 hover:border-primary-300 hover:bg-primary-50/40 transition-colors"
                >
                  <span className="flex-shrink-0 w-11 h-11 rounded-xl bg-primary-50 border border-primary-200 flex items-center justify-center text-xl">
                    {g.emoji}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-neutral-400">
                        Step {i + 1}
                      </span>
                      <span className="text-xs text-neutral-300">·</span>
                      <span className="text-xs text-neutral-400">
                        {g.readMinutes} min read
                      </span>
                    </div>
                    <h3 className="font-semibold text-neutral-900 group-hover:text-primary-700 mt-0.5">
                      {g.title}
                    </h3>
                    <p className="text-sm text-neutral-600 leading-relaxed mt-1">
                      {g.summary}
                    </p>
                  </div>
                  <svg
                    className="w-5 h-5 text-neutral-300 group-hover:text-primary-500 flex-shrink-0 mt-3"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
