import { Link } from "react-router-dom";

const REPO_URL = "https://github.com/togathernyc/togather";

export function Contribute() {
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
          Contribute to Togather
        </h1>
        <p className="text-lg text-neutral-600 mb-12 leading-relaxed">
          Togather is built by the communities that use it. Whether you write
          code or not, there are ways you can help make it better.
        </p>

        {/* Non-technical */}
        <section className="mb-14">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-neutral-900">
              Report a bug or request a feature
            </h2>
          </div>
          <p className="text-neutral-600 leading-relaxed mb-6">
            You don't need to be technical to help. If something isn't working
            right or you have an idea for how Togather could be better, you can
            file an issue on GitHub. We have templates that walk you through
            exactly what to include.
          </p>

          <div className="bg-neutral-50 border border-neutral-200 rounded-2xl p-6 mb-6">
            <h3 className="font-semibold text-neutral-900 mb-4">
              How to file an issue
            </h3>
            <ol className="space-y-3 text-neutral-600">
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-sm font-semibold flex items-center justify-center">1</span>
                <span>
                  <a href="https://github.com/signup" target="_blank" rel="noopener noreferrer" className="text-neutral-900 font-medium underline underline-offset-2">Create a free GitHub account</a> if you don't have one.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-sm font-semibold flex items-center justify-center">2</span>
                <span>
                  Go to our{" "}
                  <a href={`${REPO_URL}/issues/new/choose`} target="_blank" rel="noopener noreferrer" className="text-neutral-900 font-medium underline underline-offset-2">issue page</a> and pick the right template:
                </span>
              </li>
              <li className="pl-9 -mt-1">
                <ul className="space-y-1.5 text-neutral-500">
                  <li><strong className="text-neutral-700">Bug Report</strong> — something is broken or not working as expected</li>
                  <li><strong className="text-neutral-700">Feature Request</strong> — you have an idea for something new</li>
                </ul>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-sm font-semibold flex items-center justify-center">3</span>
                <span>
                  Fill in the template. The more detail the better — include screenshots if you can (you can paste them directly into the form).
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-sm font-semibold flex items-center justify-center">4</span>
                <span>Submit, and we'll take it from there.</span>
              </li>
            </ol>
          </div>

          <a
            href={`${REPO_URL}/issues/new/choose`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-3 bg-neutral-900 hover:bg-neutral-800 text-white rounded-xl font-medium transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
            File an issue on GitHub
          </a>
        </section>

        {/* Technical */}
        <section className="mb-14">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-violet-50 border border-violet-200 flex items-center justify-center text-violet-700">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-neutral-900">
              Contribute code
            </h2>
          </div>
          <p className="text-neutral-600 leading-relaxed mb-6">
            Togather is source-available under the{" "}
            <a href={`${REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer" className="text-neutral-900 font-medium underline underline-offset-2">AGPL-3.0 license</a>.
            If you're a developer and want to contribute, here's how to get started.
          </p>

          <div className="bg-neutral-50 border border-neutral-200 rounded-2xl p-6 mb-6">
            <h3 className="font-semibold text-neutral-900 mb-4">
              Requirements
            </h3>
            <ul className="space-y-2 text-neutral-600">
              <li className="flex gap-2">
                <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
                <span>Node.js v20+</span>
              </li>
              <li className="flex gap-2">
                <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
                <span>pnpm v8+</span>
              </li>
              <li className="flex gap-2">
                <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
                <span>A free <a href="https://convex.dev" target="_blank" rel="noopener noreferrer" className="text-neutral-900 font-medium underline underline-offset-2">Convex</a> account (for the backend)</span>
              </li>
            </ul>
          </div>

          <div className="bg-neutral-50 border border-neutral-200 rounded-2xl p-6 mb-6">
            <h3 className="font-semibold text-neutral-900 mb-4">
              Getting started
            </h3>
            <div className="space-y-3 text-neutral-600 font-mono text-sm">
              <div className="bg-neutral-900 text-neutral-100 rounded-xl p-4 overflow-x-auto">
                <pre className="whitespace-pre">{`# Clone the repo
git clone ${REPO_URL}.git
cd togather

# Install dependencies
pnpm install

# Set up environment
cp .env.example .env.local

# Start Convex (creates your dev database)
npx convex dev

# In a new terminal — seed test data
npx convex run functions/seed:seedDemoData

# Start the app
pnpm dev`}</pre>
              </div>
            </div>
            <p className="text-neutral-500 text-sm mt-4">
              Full setup instructions are in the{" "}
              <a href={`${REPO_URL}#readme`} target="_blank" rel="noopener noreferrer" className="text-neutral-700 font-medium underline underline-offset-2">README</a>.
            </p>
          </div>

          <div className="bg-neutral-50 border border-neutral-200 rounded-2xl p-6 mb-6">
            <h3 className="font-semibold text-neutral-900 mb-4">
              Contribution workflow
            </h3>
            <ol className="space-y-2 text-neutral-600 list-decimal list-inside">
              <li>Pick an issue from the <a href={`${REPO_URL}/issues`} target="_blank" rel="noopener noreferrer" className="text-neutral-900 font-medium underline underline-offset-2">issue tracker</a> (look for <code className="bg-neutral-200 px-1.5 py-0.5 rounded text-sm">good first issue</code>)</li>
              <li>Fork the repo and create a branch</li>
              <li>Make your changes and write tests</li>
              <li>Open a pull request with a clear description</li>
              <li>We'll review and work with you to get it merged</li>
            </ol>
          </div>

          <div className="flex flex-wrap gap-3">
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-3 bg-neutral-900 hover:bg-neutral-800 text-white rounded-xl font-medium transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
              </svg>
              View on GitHub
            </a>
            <a
              href={`${REPO_URL}/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-3 bg-white hover:bg-neutral-50 text-neutral-900 rounded-xl font-medium border border-neutral-200 transition-colors"
            >
              Browse good first issues
            </a>
          </div>
        </section>

        {/* Tech stack summary */}
        <section className="mb-8">
          <h2 className="text-2xl font-bold text-neutral-900 mb-4">
            Tech stack
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              { label: "Backend", value: "Convex" },
              { label: "Mobile", value: "React Native + Expo" },
              { label: "Routing", value: "Expo Router" },
              { label: "Language", value: "TypeScript" },
              { label: "Styling", value: "Tailwind CSS / NativeWind" },
              { label: "Auth", value: "Phone & Email OTP" },
            ].map((item) => (
              <div key={item.label} className="bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-3">
                <div className="text-xs text-neutral-400 font-medium uppercase tracking-wide">{item.label}</div>
                <div className="text-neutral-900 font-medium">{item.value}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
