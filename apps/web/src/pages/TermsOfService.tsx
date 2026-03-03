import { Link } from "react-router-dom";

const LAST_UPDATED = "January 3, 2026";
const CONTACT_EMAIL = "togather@supa.media";

export function TermsOfService() {
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

        <h1 className="text-4xl font-bold text-neutral-900 mb-2">
          Terms of Service
        </h1>
        <p className="text-neutral-500 mb-8">Last updated: {LAST_UPDATED}</p>

        <div className="prose prose-neutral max-w-none">
          <Section title="1. Acceptance of Terms">
            <p className="text-neutral-600">
              By accessing and using Togather ("the App"), you accept and agree
              to be bound by these Terms of Service ("Terms"). If you do not
              agree to these Terms, you may not use the App.
            </p>
            <p className="text-neutral-600 mt-4">
              These Terms apply to all users, including community members,
              leaders, and administrators.
            </p>
          </Section>

          <Section title="2. User Accounts">
            <p className="text-neutral-600 mb-4">
              To use certain features of the App, you must create an account. You
              agree to:
            </p>
            <ul className="list-disc pl-6 text-neutral-600 space-y-1">
              <li>
                Provide accurate and complete information when creating your
                account
              </li>
              <li>
                Keep your account credentials secure and not share them with
                others
              </li>
              <li>
                Be responsible for all activities that occur under your account
              </li>
              <li>
                Notify us immediately of any unauthorized use of your account
              </li>
            </ul>
            <p className="text-neutral-600 mt-4">
              You must be at least 13 years old to create an account. If you are
              under 18, you must have parental or guardian consent to use the
              App.
            </p>
          </Section>

          <Section title="3. User-Generated Content">
            <p className="text-neutral-600">
              The App allows you to post, share, and interact with content
              created by you and other users ("User Content"). You retain
              ownership of your User Content, but by posting it, you grant
              Togather a non-exclusive, royalty-free license to use, display, and
              distribute your content within the App.
            </p>
            <p className="text-neutral-600 mt-4">
              You are solely responsible for your User Content and the
              consequences of sharing it.
            </p>
          </Section>

          <Section title="4. Prohibited Content and Conduct">
            <p className="text-neutral-600 font-semibold mb-4">
              We have zero tolerance for objectionable content or abusive users.
            </p>
            <p className="text-neutral-600 mb-4">
              You agree NOT to post, share, or engage in any of the following:
            </p>
            <ul className="list-disc pl-6 text-neutral-600 space-y-2">
              <li>
                <strong>Harassment or bullying:</strong> Content that threatens,
                harasses, bullies, or intimidates any person
              </li>
              <li>
                <strong>Hate speech:</strong> Content that promotes violence,
                discrimination, or hatred based on race, ethnicity, religion,
                gender, sexual orientation, disability, or any other protected
                characteristic
              </li>
              <li>
                <strong>Sexual content:</strong> Sexually explicit, pornographic,
                or suggestive content of any kind
              </li>
              <li>
                <strong>Violence:</strong> Graphic violence, gore, or content
                that promotes or glorifies violence
              </li>
              <li>
                <strong>Illegal content:</strong> Content that violates any law,
                promotes illegal activities, or infringes on others' rights
              </li>
              <li>
                <strong>Spam:</strong> Unsolicited advertising, promotional
                content, or repetitive messages
              </li>
              <li>
                <strong>Impersonation:</strong> Pretending to be someone else or
                misrepresenting your identity
              </li>
              <li>
                <strong>Harmful content:</strong> Content that could harm minors,
                promotes self-harm, or contains dangerous misinformation
              </li>
            </ul>
          </Section>

          <Section title="5. Content Moderation and Reporting">
            <p className="text-neutral-600 mb-4">
              We are committed to maintaining a safe community. To achieve this:
            </p>
            <ul className="list-disc pl-6 text-neutral-600 space-y-2">
              <li>
                <strong>Reporting:</strong> You can report any content or user
                that violates these Terms by using the "Report" feature in the
                App. Long-press any message to access the report option.
              </li>
              <li>
                <strong>Blocking:</strong> You can block any user at any time.
                Blocked users will not be able to see your content or contact
                you. When you block a user, their content is immediately removed
                from your view.
              </li>
              <li>
                <strong>Review Process:</strong> Our moderation team reviews all
                reports within 24 hours. Appropriate action will be taken, which
                may include content removal, warnings, temporary suspension, or
                permanent account termination.
              </li>
              <li>
                <strong>Appeals:</strong> If you believe your content was wrongly
                removed or your account was wrongly suspended, you may contact us
                to appeal the decision.
              </li>
            </ul>
          </Section>

          <Section title="6. Enforcement Actions">
            <p className="text-neutral-600 mb-4">
              Violations of these Terms may result in:
            </p>
            <ul className="list-disc pl-6 text-neutral-600 space-y-1">
              <li>Removal of the offending content</li>
              <li>Temporary suspension of your account</li>
              <li>Permanent termination of your account</li>
              <li>Reporting to law enforcement where required by law</li>
            </ul>
            <p className="text-neutral-600 mt-4">
              The severity of the action depends on the nature and frequency of
              the violation. Repeat offenders and severe violations (such as
              illegal content or threats of violence) will result in immediate
              and permanent account termination.
            </p>
          </Section>

          <Section title="7. Intellectual Property">
            <p className="text-neutral-600">
              The App and its original content (excluding User Content) are owned
              by Togather and are protected by copyright, trademark, and other
              laws. You may not copy, modify, distribute, or create derivative
              works based on our content without written permission.
            </p>
          </Section>

          <Section title="8. Privacy">
            <p className="text-neutral-600">
              Your privacy is important to us. Please review our{" "}
              <Link
                to="/legal/privacy"
                className="text-blue-600 hover:text-blue-800"
              >
                Privacy Policy
              </Link>{" "}
              to understand how we collect, use, and protect your personal
              information.
            </p>
          </Section>

          <Section title="9. Disclaimer of Warranties">
            <p className="text-neutral-600">
              The App is provided "as is" and "as available" without warranties
              of any kind, either express or implied. We do not guarantee that
              the App will be uninterrupted, secure, or error-free.
            </p>
          </Section>

          <Section title="10. Limitation of Liability">
            <p className="text-neutral-600">
              To the maximum extent permitted by law, Togather shall not be
              liable for any indirect, incidental, special, consequential, or
              punitive damages arising out of your use of the App.
            </p>
          </Section>

          <Section title="11. Changes to Terms">
            <p className="text-neutral-600">
              We may update these Terms from time to time. We will notify you of
              any material changes by posting the new Terms in the App and
              updating the "Last updated" date. Your continued use of the App
              after such changes constitutes acceptance of the new Terms.
            </p>
          </Section>

          <Section title="12. Contact Us">
            <p className="text-neutral-600">
              If you have any questions about these Terms, please contact us at:
            </p>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-blue-600 hover:text-blue-800 mt-2 inline-block"
            >
              {CONTACT_EMAIL}
            </a>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-8">
      <h3 className="text-xl font-semibold text-neutral-900 mb-4">{title}</h3>
      {children}
    </div>
  );
}
