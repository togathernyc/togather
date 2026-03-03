import { Link } from "react-router-dom";

const LAST_UPDATED = "December 28, 2024";
const CONTACT_EMAIL = "togather@supa.media";

export function PrivacyPolicy() {
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
          Privacy Policy
        </h1>
        <p className="text-neutral-500 mb-8">Last updated: {LAST_UPDATED}</p>

        <div className="prose prose-neutral max-w-none">
          <p className="text-neutral-600 leading-relaxed mb-8">
            Togather ("we," "our," or "us") is committed to protecting your
            privacy. This Privacy Policy explains how we collect, use, disclose,
            and safeguard your information when you use our mobile application
            and related services (collectively, the "Service").
          </p>

          <Section title="1. Information We Collect">
            <h4 className="font-semibold text-neutral-800 mt-4 mb-2">
              Information You Provide
            </h4>
            <ul className="list-disc pl-6 text-neutral-600 space-y-1">
              <li>
                Account information: name, email address, phone number, and
                profile photo
              </li>
              <li>Profile information: bio, interests, and preferences</li>
              <li>Group and community information: groups you create or join</li>
              <li>Communications: messages you send through our chat features</li>
              <li>
                Event information: RSVPs, attendance records, and event
                participation
              </li>
            </ul>

            <h4 className="font-semibold text-neutral-800 mt-4 mb-2">
              Information Collected Automatically
            </h4>
            <ul className="list-disc pl-6 text-neutral-600 space-y-1">
              <li>
                Device information: device type, operating system, and unique
                device identifiers
              </li>
              <li>
                Usage data: features used, actions taken, and time spent in the
                app
              </li>
              <li>
                Location data: with your permission, approximate location for
                finding nearby groups
              </li>
            </ul>
          </Section>

          <Section title="2. How We Use Your Information">
            <p className="text-neutral-600 mb-4">
              We use the information we collect to:
            </p>
            <ul className="list-disc pl-6 text-neutral-600 space-y-1">
              <li>Provide, operate, and maintain the Service</li>
              <li>Create and manage your account</li>
              <li>Enable you to join and participate in groups and communities</li>
              <li>Facilitate communication between group members</li>
              <li>Send you notifications about group activities and events</li>
              <li>Respond to your inquiries and provide customer support</li>
              <li>Improve and personalize your experience</li>
              <li>Ensure the security and integrity of our Service</li>
              <li>Comply with legal obligations</li>
            </ul>
          </Section>

          <Section title="3. Information Sharing">
            <p className="text-neutral-600 mb-4">
              We may share your information in the following circumstances:
            </p>
            <ul className="list-disc pl-6 text-neutral-600 space-y-1">
              <li>
                <strong>With other group members:</strong> Your profile
                information and messages are visible to members of groups you
                join
              </li>
              <li>
                <strong>With group leaders:</strong> Leaders can see member
                information and attendance for their groups
              </li>
              <li>
                <strong>With service providers:</strong> We use third-party
                services that help us operate the Service
              </li>
              <li>
                <strong>For legal reasons:</strong> When required by law or to
                protect our rights and safety
              </li>
              <li>
                <strong>With your consent:</strong> When you explicitly agree to
                share information
              </li>
            </ul>
          </Section>

          <Section title="4. Third-Party Services">
            <p className="text-neutral-600">
              Our Service uses third-party service providers to help us operate,
              including services for authentication, data storage, messaging, and
              mapping. These providers have their own privacy policies governing
              their use of your information. We only share information with these
              providers as necessary to deliver the Service to you.
            </p>
          </Section>

          <Section title="5. Data Retention">
            <p className="text-neutral-600">
              We retain your personal information for as long as your account is
              active or as needed to provide you with the Service. You may
              request deletion of your account and associated data at any time by
              contacting us. Some information may be retained as required by law
              or for legitimate business purposes.
            </p>
          </Section>

          <Section title="6. Data Security">
            <p className="text-neutral-600">
              We implement appropriate technical and organizational security
              measures to protect your personal information against unauthorized
              access, alteration, disclosure, or destruction. However, no method
              of transmission over the Internet or electronic storage is 100%
              secure, and we cannot guarantee absolute security.
            </p>
          </Section>

          <Section title="7. Your Rights and Choices">
            <p className="text-neutral-600 mb-4">You have the right to:</p>
            <ul className="list-disc pl-6 text-neutral-600 space-y-1">
              <li>
                Access and update your personal information through your account
                settings
              </li>
              <li>Delete your account and personal data</li>
              <li>Opt out of promotional communications</li>
              <li>Control location sharing through your device settings</li>
              <li>Request a copy of your data</li>
            </ul>
            <p className="text-neutral-600 mt-4">
              To exercise these rights, please contact us using the information
              below.
            </p>
          </Section>

          <Section title="8. Children's Privacy">
            <p className="text-neutral-600">
              Our Service is not directed to children under 13 years of age. We
              do not knowingly collect personal information from children under
              13. If we learn that we have collected personal information from a
              child under 13, we will take steps to delete such information
              promptly. If you believe we may have collected information from a
              child under 13, please contact us.
            </p>
          </Section>

          <Section title="9. International Data Transfers">
            <p className="text-neutral-600">
              Your information may be transferred to and processed in countries
              other than your country of residence. These countries may have
              different data protection laws. By using our Service, you consent
              to the transfer of your information to these countries.
            </p>
          </Section>

          <Section title="10. Changes to This Privacy Policy">
            <p className="text-neutral-600">
              We may update this Privacy Policy from time to time. We will notify
              you of any changes by posting the new Privacy Policy on this page
              and updating the "Last updated" date. We encourage you to review
              this Privacy Policy periodically for any changes.
            </p>
          </Section>

          <Section title="11. Contact Us">
            <p className="text-neutral-600">
              If you have any questions about this Privacy Policy or our privacy
              practices, please contact us at:
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
