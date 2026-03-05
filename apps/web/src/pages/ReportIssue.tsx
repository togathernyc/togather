import { Link } from "react-router-dom";

const REPO_URL = "https://github.com/togathernyc/togather";

export function ReportIssue() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-6 py-12">
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

        <h1 className="text-4xl font-bold text-neutral-900 mb-3">
          Report a problem or request a feature
        </h1>
        <p className="text-lg text-neutral-600 mb-6 leading-relaxed">
          Togather is an open-source project built and maintained by a small
          team and the community around it. Every bug report and feature request
          helps make it better for everyone.
        </p>

        {/* Community effort callout */}
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 mb-12">
          <p className="text-amber-900 leading-relaxed">
            <strong>This is a community effort.</strong> Issues are addressed on
            a best-effort basis by contributors who volunteer their time. The
            more detail you provide, the easier it is for someone to pick it up.
            If a fix is important to you, consider{" "}
            <Link to="/contribute" className="font-medium underline underline-offset-2">
              contributing it yourself
            </Link>
            — we're happy to help you get started.
          </p>
        </div>

        {/* Bug report section */}
        <section className="mb-14">
          <h2 className="text-2xl font-bold text-neutral-900 mb-2">
            Reporting a bug
          </h2>
          <p className="text-neutral-600 leading-relaxed mb-6">
            Something not working right? Here's how to write a bug report that
            helps us fix it fast.
          </p>

          <div className="bg-neutral-50 border border-neutral-200 rounded-2xl p-6 mb-6">
            <h3 className="font-semibold text-neutral-900 mb-4">
              What to include
            </h3>
            <ul className="space-y-4 text-neutral-600">
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-sm font-semibold flex items-center justify-center">1</span>
                <div>
                  <strong className="text-neutral-900">What happened</strong>
                  <p className="text-sm mt-0.5">Describe exactly what you saw. "The app crashed" is okay, but "I tapped Send on a message with a photo and the app froze for 5 seconds then closed" is much better.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-sm font-semibold flex items-center justify-center">2</span>
                <div>
                  <strong className="text-neutral-900">Steps to reproduce</strong>
                  <p className="text-sm mt-0.5">Walk us through what you did, step by step. If we can recreate the problem, we can fix it.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-sm font-semibold flex items-center justify-center">3</span>
                <div>
                  <strong className="text-neutral-900">Screenshots</strong>
                  <p className="text-sm mt-0.5">A picture is worth a thousand words. Take 1-3 screenshots showing the problem. You can paste them directly into the GitHub form.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-sm font-semibold flex items-center justify-center">4</span>
                <div>
                  <strong className="text-neutral-900">What you expected</strong>
                  <p className="text-sm mt-0.5">Tell us what you thought should happen. This helps us understand if something is a bug or a misunderstanding.</p>
                </div>
              </li>
            </ul>
          </div>

          <a
            href={`${REPO_URL}/issues/new?template=bug_report.yml`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-3 bg-neutral-900 hover:bg-neutral-800 text-white rounded-xl font-medium transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
            Report a bug
          </a>
        </section>

        {/* Feature request section */}
        <section className="mb-14">
          <h2 className="text-2xl font-bold text-neutral-900 mb-2">
            Requesting a feature
          </h2>
          <p className="text-neutral-600 leading-relaxed mb-6">
            Have an idea for how Togather could work better for your community?
            We want to hear it.
          </p>

          <div className="bg-neutral-50 border border-neutral-200 rounded-2xl p-6 mb-6">
            <h3 className="font-semibold text-neutral-900 mb-4">
              Tips for a great request
            </h3>
            <ul className="space-y-4 text-neutral-600">
              <li className="flex gap-3">
                <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
                <div>
                  <strong className="text-neutral-900">Start with the problem, not the solution</strong>
                  <p className="text-sm mt-0.5">"I can't tell which members haven't shown up in weeks" is more helpful than "Add a red dot next to inactive members." Understanding the problem helps us design the best fix.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
                <div>
                  <strong className="text-neutral-900">Explain who it helps</strong>
                  <p className="text-sm mt-0.5">Is this for group leaders? Members? Admins? Knowing the audience helps us prioritize.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
                <div>
                  <strong className="text-neutral-900">Include screenshots or examples</strong>
                  <p className="text-sm mt-0.5">If you've seen something similar in another app, share a screenshot. A rough sketch or mockup works too.</p>
                </div>
              </li>
            </ul>
          </div>

          <a
            href={`${REPO_URL}/issues/new?template=feature_request.yml`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-3 bg-neutral-900 hover:bg-neutral-800 text-white rounded-xl font-medium transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
            Request a feature
          </a>
        </section>

        {/* Getting started with GitHub */}
        <section className="mb-8">
          <h2 className="text-2xl font-bold text-neutral-900 mb-2">
            New to GitHub?
          </h2>
          <p className="text-neutral-600 leading-relaxed mb-6">
            GitHub is where we track all bugs and feature requests. You'll need
            a free account to submit an issue — it only takes a minute.
          </p>

          <ol className="space-y-3 text-neutral-600 mb-6">
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-sm font-semibold flex items-center justify-center">1</span>
              <span>
                Go to{" "}
                <a href="https://github.com/signup" target="_blank" rel="noopener noreferrer" className="text-neutral-900 font-medium underline underline-offset-2">github.com/signup</a>{" "}
                and create an account with your email.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-sm font-semibold flex items-center justify-center">2</span>
              <span>Click one of the buttons above ("Report a bug" or "Request a feature").</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-sm font-semibold flex items-center justify-center">3</span>
              <span>Fill in the template — the form will guide you through what to include.</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-sm font-semibold flex items-center justify-center">4</span>
              <span>Hit submit, and we'll take it from there.</span>
            </li>
          </ol>

          <p className="text-neutral-500 text-sm">
            Want to go further?{" "}
            <Link to="/contribute" className="text-neutral-700 font-medium underline underline-offset-2">
              Learn how to contribute code
            </Link>{" "}
            to Togather.
          </p>
        </section>
      </div>
    </div>
  );
}
