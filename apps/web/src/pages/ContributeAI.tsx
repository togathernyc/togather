import { Link } from "react-router-dom";

const REPO_URL = "https://github.com/togathernyc/togather";

/**
 * Guide to Togather's AI-driven contribution workflow.
 *
 * Audience: contributors with little or no coding experience who understand
 * tech and product. The page deliberately explains the *process* (specs,
 * risk levels, review gates) and stays away from code-level mechanics —
 * the AI handles those.
 */
export function ContributeAI() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <Link
          to="/contribute"
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
          Back to Contribute
        </Link>

        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-50 border border-violet-200 text-violet-700 text-sm font-medium mb-4">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l1.9 5.7L19.6 10l-5.7 1.9L12 17.6l-1.9-5.7L4.4 10l5.7-1.9L12 3z" />
          </svg>
          AI-driven development
        </div>

        <h1 className="text-4xl font-bold text-neutral-900 mb-3">
          Contribute without writing code
        </h1>
        <p className="text-lg text-neutral-600 mb-12 leading-relaxed">
          Togather is built with an AI-driven development workflow. You bring
          the product thinking — what should change and why. AI figures out the
          code. A maintainer decides what ships. If you can describe a problem
          clearly, you can contribute.
        </p>

        {/* Division of labor */}
        <section className="mb-14">
          <h2 className="text-2xl font-bold text-neutral-900 mb-4">
            Who does what
          </h2>
          <p className="text-neutral-600 leading-relaxed mb-6">
            The most valuable thing you can contribute isn't code — it's a
            precise description of what the app should do. Think of yourself as
            the product owner for your change. The technical "how" is
            deliberately left to AI.
          </p>
          <div className="grid md:grid-cols-3 gap-3">
            <div className="bg-neutral-50 border border-neutral-200 rounded-2xl p-5">
              <div className="text-xs text-neutral-400 font-medium uppercase tracking-wide mb-2">You</div>
              <ul className="space-y-2 text-neutral-600 text-sm leading-relaxed">
                <li>Spot problems and opportunities in the app</li>
                <li>Describe the desired behavior and why it matters</li>
                <li>Define what "done" looks like</li>
                <li>Verify the result works as you intended</li>
              </ul>
            </div>
            <div className="bg-neutral-50 border border-neutral-200 rounded-2xl p-5">
              <div className="text-xs text-neutral-400 font-medium uppercase tracking-wide mb-2">AI</div>
              <ul className="space-y-2 text-neutral-600 text-sm leading-relaxed">
                <li>Turns your report into a detailed technical spec</li>
                <li>Assesses how risky the change is</li>
                <li>Writes the code and tests</li>
                <li>Opens a pull request with screenshots and results</li>
              </ul>
            </div>
            <div className="bg-neutral-50 border border-neutral-200 rounded-2xl p-5">
              <div className="text-xs text-neutral-400 font-medium uppercase tracking-wide mb-2">Maintainer</div>
              <ul className="space-y-2 text-neutral-600 text-sm leading-relaxed">
                <li>Sets product direction</li>
                <li>Reviews higher-risk changes</li>
                <li>Makes the final merge decision</li>
                <li>Ships releases</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Workflow 1 */}
        <section className="mb-14">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-700 font-bold">
              1
            </div>
            <h2 className="text-2xl font-bold text-neutral-900">
              The guided workflow
            </h2>
          </div>
          <p className="text-neutral-600 leading-relaxed mb-6">
            This is the default path for most contributions. You describe the
            change, AI drafts a detailed spec and builds it, and a maintainer
            makes the final call on merging. You stay in the loop at the two
            points where product judgment matters: approving the spec, and
            verifying the result.
          </p>

          <div className="bg-neutral-50 border border-neutral-200 rounded-2xl p-6">
            <ol className="space-y-4 text-neutral-600">
              {[
                {
                  title: "Describe the bug or idea",
                  body: (
                    <>
                      Submit it in the Togather app's dev dashboard (Settings
                      &rarr; Contribute). Plain language is fine — say what you
                      saw, what you expected, and why it matters. Screenshots
                      help a lot. (Prefer GitHub? Filing an issue there works
                      too.)
                    </>
                  ),
                },
                {
                  title: "AI turns it into a detailed spec",
                  body: (
                    <>
                      The AI agent investigates the codebase, reproduces the
                      bug where it can, and rewrites your report as a
                      structured spec: affected screens, expected behavior,
                      edge cases, and acceptance criteria.
                    </>
                  ),
                },
                {
                  title: "You review the spec",
                  body: (
                    <>
                      This is a product review, not a technical one. Read the
                      spec in the dashboard and answer one question:{" "}
                      <em>is this what I meant?</em> Correct anything that's
                      off — the agent will revise.
                    </>
                  ),
                },
                {
                  title: "Approve the spec",
                  body: (
                    <>
                      When the spec matches your intent, approve it in the
                      dashboard. Low-risk changes start building automatically
                      the moment you approve; bigger ones wait for an explicit
                      "Start build" go-ahead.
                    </>
                  ),
                },
                {
                  title: "AI implements and opens a pull request",
                  body: (
                    <>
                      The agent writes the code and tests, verifies the change,
                      and opens a pull request that includes before/after
                      screenshots and a plain-language summary of what changed.
                    </>
                  ),
                },
                {
                  title: "You verify, a maintainer merges",
                  body: (
                    <>
                      Check the screenshots (or the preview build) against your
                      acceptance criteria and confirm it does what you asked.
                      A maintainer makes the final merge decision on GitHub —
                      you can track every status change in the dashboard, and
                      you'll get a push notification when your change ships.
                    </>
                  ),
                },
              ].map((step, i) => (
                <li key={step.title} className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-sm font-semibold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <span>
                    <strong className="text-neutral-900 block mb-0.5">{step.title}</strong>
                    {step.body}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <p className="text-neutral-600 text-sm leading-relaxed mt-4">
            Behind the scenes, every dashboard item links to its real GitHub
            issue and pull request — and if you add your GitHub username, you
            get co-author credit on the commits: public open-source
            contributions you can show employers.
          </p>
        </section>

        {/* Workflow 2 */}
        <section className="mb-14">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700 font-bold">
              2
            </div>
            <h2 className="text-2xl font-bold text-neutral-900">
              The end-to-end workflow
            </h2>
          </div>
          <p className="text-neutral-600 leading-relaxed mb-6">
            For changes that are clearly low risk, the pipeline runs from your
            approval onward without a human in the middle: the change is
            implemented, verified, and merged automatically. Your approved
            spec is the only human input — which is exactly why writing a good
            one matters.
          </p>

          <div className="bg-neutral-50 border border-neutral-200 rounded-2xl p-6 mb-6">
            <ol className="space-y-3 text-neutral-600">
              {[
                <>You submit a bug or idea and approve its spec in the
                  dashboard, just like the guided workflow.</>,
                <>An AI triage step reads the spec, works out which parts of the
                  codebase it touches, and assigns a risk level automatically.</>,
                <>
                  <strong className="text-neutral-700">Low risk:</strong> the
                  build starts the moment you approve the spec. AI implements,
                  verifies with automated tests and screenshots, and merges on
                  its own. It ships in the next release.
                </>,
                <>
                  <strong className="text-neutral-700">Medium or high risk:</strong>{" "}
                  the change automatically falls back to the guided workflow
                  above — a build starts on an explicit go-ahead, AI still
                  builds it, but a maintainer reviews and merges.
                </>,
              ].map((item, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-sm font-semibold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-amber-800 text-sm leading-relaxed">
            <strong className="block mb-1">Trust, but verify.</strong>
            Every auto-merged change is still recorded in a pull request with
            screenshots and test results, and maintainers can override any risk
            label or revert any change. Automation removes waiting, not
            accountability.
          </div>
        </section>

        {/* Risk levels */}
        <section className="mb-14">
          <h2 className="text-2xl font-bold text-neutral-900 mb-4">
            Risk levels
          </h2>
          <p className="text-neutral-600 leading-relaxed mb-6">
            Which workflow a change takes is decided by its risk level. Risk is
            about blast radius: how much of the app could break if the change
            is wrong. An AI triage step assigns the level while drafting the
            spec, and maintainers can always override it.
          </p>

          <div className="space-y-3">
            <div className="border border-emerald-200 bg-emerald-50/50 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <h3 className="font-semibold text-neutral-900">
                  Low risk <code className="ml-1 bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded text-xs font-mono">risk:low</code>
                </h3>
                <span className="ml-auto text-xs font-medium text-emerald-700">eligible for auto-merge</span>
              </div>
              <p className="text-neutral-600 text-sm leading-relaxed">
                Changes confined to a single screen's look or copy: text and
                label fixes, spacing, colors, icons, empty states. Nothing
                shared, no data or logic changes. Worst case, one screen looks
                wrong and we fix it in the next update.
              </p>
            </div>

            <div className="border border-amber-200 bg-amber-50/50 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <h3 className="font-semibold text-neutral-900">
                  Medium risk <code className="ml-1 bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded text-xs font-mono">risk:medium</code>
                </h3>
                <span className="ml-auto text-xs font-medium text-amber-700">maintainer reviews</span>
              </div>
              <p className="text-neutral-600 text-sm leading-relaxed">
                Changes to one feature's behavior on one side of the stack — a
                new screen, a tweak to how a single feature works — without
                touching shared components or how data is stored. A bug here
                breaks one feature, not the app.
              </p>
            </div>

            <div className="border border-red-200 bg-red-50/50 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                <h3 className="font-semibold text-neutral-900">
                  High risk <code className="ml-1 bg-red-100 text-red-800 px-1.5 py-0.5 rounded text-xs font-mono">risk:high</code>
                </h3>
                <span className="ml-auto text-xs font-medium text-red-700">maintainer reviews, may need design discussion</span>
              </div>
              <p className="text-neutral-600 text-sm leading-relaxed">
                Anything that touches shared components used across the app,
                changes both the app and the backend together, or affects how
                data is stored, sign-in, notifications, or offline support. A
                bug here can break many things at once, so a human always
                reviews — and big ones may need a design conversation before
                any code is written.
              </p>
            </div>
          </div>
        </section>

        {/* Writing a good spec */}
        <section className="mb-14">
          <h2 className="text-2xl font-bold text-neutral-900 mb-4">
            Writing a spec AI can build from
          </h2>
          <p className="text-neutral-600 leading-relaxed mb-6">
            Your spec is the contract. AI is very good at figuring out{" "}
            <em>how</em> to build something and very bad at guessing{" "}
            <em>what</em> you actually wanted. Every ambiguity in your spec is
            a decision the AI makes for you — so spend your effort on the
            product details, not the technical ones.
          </p>

          <div className="bg-neutral-50 border border-neutral-200 rounded-2xl p-6 mb-6">
            <h3 className="font-semibold text-neutral-900 mb-4">
              Every good spec answers four questions
            </h3>
            <ul className="space-y-3 text-neutral-600">
              <li className="flex gap-3">
                <strong className="text-neutral-900 flex-shrink-0 w-24">Where?</strong>
                <span>Which screen, and how you got there. "The group chat screen, after tapping a group from the Groups tab."</span>
              </li>
              <li className="flex gap-3">
                <strong className="text-neutral-900 flex-shrink-0 w-24">What?</strong>
                <span>What happens now vs. what should happen instead. Be literal — quote the exact text you see on screen.</span>
              </li>
              <li className="flex gap-3">
                <strong className="text-neutral-900 flex-shrink-0 w-24">Why?</strong>
                <span>Who is affected and what it costs them. This is how maintainers prioritize, and how AI makes judgment calls that match your intent.</span>
              </li>
              <li className="flex gap-3">
                <strong className="text-neutral-900 flex-shrink-0 w-24">Done when?</strong>
                <span>A checklist of things that must be true when it's finished. These acceptance criteria are what the AI verifies against — and what you check in the final pull request.</span>
              </li>
            </ul>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div className="border border-emerald-200 rounded-2xl p-5">
              <h3 className="font-semibold text-emerald-700 mb-3 text-sm uppercase tracking-wide">Do</h3>
              <ul className="space-y-2 text-neutral-600 text-sm leading-relaxed">
                <li>Describe behavior: "when I tap X, Y should happen"</li>
                <li>Attach screenshots or a screen recording</li>
                <li>Call out edge cases you can think of (empty lists, long names, no signal)</li>
                <li>Say what's <em>out of scope</em> so the change stays small</li>
                <li>Split big ideas into several small issues</li>
              </ul>
            </div>
            <div className="border border-red-200 rounded-2xl p-5">
              <h3 className="font-semibold text-red-700 mb-3 text-sm uppercase tracking-wide">Don't</h3>
              <ul className="space-y-2 text-neutral-600 text-sm leading-relaxed">
                <li>Prescribe the implementation — "which file to edit" is the AI's job</li>
                <li>Bundle several unrelated changes into one issue</li>
                <li>Write "it's broken" without steps to see it yourself</li>
                <li>Skip the "why" — it's the part only you can supply</li>
                <li>Worry about technical vocabulary; plain language is better</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Glossary */}
        <section className="mb-14">
          <h2 className="text-2xl font-bold text-neutral-900 mb-4">
            The five GitHub words you need
          </h2>
          <p className="text-neutral-600 leading-relaxed mb-6">
            The dashboard is the front door, but the code, reviews, and merges
            live on GitHub — and every dashboard item links out to them. You
            only need a handful of terms to follow along.
          </p>
          <div className="bg-neutral-50 border border-neutral-200 rounded-2xl p-6">
            <dl className="space-y-3 text-neutral-600 text-sm leading-relaxed">
              {[
                ["Issue", "A tracked request — a bug report or feature idea. This is where your spec lives."],
                ["Label", "A colored tag on an issue, like risk:low. Labels mirror where a change is in the pipeline and how risky it is."],
                ["Pull request (PR)", "A proposed change to the app, with the code, screenshots, and test results attached. AI opens these; humans (or automation) approve them."],
                ["Merge", "Accepting a pull request into the app. After merging, the change ships in the next release."],
                ["CI", "The automated checks that run on every pull request — tests, checks that the app still builds, and our risk-level rules."],
              ].map(([term, def]) => (
                <div key={term} className="flex gap-3">
                  <dt className="font-semibold text-neutral-900 flex-shrink-0 w-32">{term}</dt>
                  <dd>{def}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* CTA */}
        <section className="mb-8">
          <h2 className="text-2xl font-bold text-neutral-900 mb-4">
            Start contributing
          </h2>
          <p className="text-neutral-600 leading-relaxed mb-6">
            The best first contribution is a well-written bug report about
            something that annoyed you this week. Open Settings &rarr;
            Contribute in the Togather app and describe it — or, if you're
            more at home on GitHub, file an issue there.
          </p>
          <div className="flex flex-wrap gap-3">
            <a
              href={`${REPO_URL}/issues/new/choose`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-3 bg-neutral-900 hover:bg-neutral-800 text-white rounded-xl font-medium transition-colors"
            >
              File an issue
            </a>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-3 bg-white hover:bg-neutral-50 text-neutral-900 rounded-xl font-medium border border-neutral-200 transition-colors"
            >
              View on GitHub
            </a>
            <Link
              to="/contribute"
              className="inline-flex items-center gap-2 px-5 py-3 bg-white hover:bg-neutral-50 text-neutral-900 rounded-xl font-medium border border-neutral-200 transition-colors"
            >
              Prefer to write code yourself?
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
