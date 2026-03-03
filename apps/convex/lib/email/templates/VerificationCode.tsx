import { Section, Text, Heading } from "@react-email/components";
import { BaseLayout } from "./BaseLayout";

interface VerificationCodeEmailProps {
  code: string;
  email: string;
}

export const verificationCodeSubject = "Your Togather verification code";

export function VerificationCodeEmail({
  code,
  email,
}: VerificationCodeEmailProps) {
  return (
    <BaseLayout>
      <Section>
        <Heading style={styles.heading}>Verify your email</Heading>
        <Text style={styles.text}>
          Your verification code is:
        </Text>
        <Section style={styles.codeContainer}>
          <Text style={styles.code}>{code}</Text>
        </Section>
        <Text style={styles.subtext}>
          This code expires in 10 minutes.
        </Text>
        <Text style={styles.subtext}>
          We're verifying {email}. If you didn't request this code, you can
          safely ignore this email.
        </Text>
      </Section>
    </BaseLayout>
  );
}

const styles = {
  heading: {
    color: "#1a1a1a",
    fontSize: "24px",
    fontWeight: "600" as const,
    margin: "0 0 16px",
    textAlign: "center" as const,
  },
  text: {
    color: "#333",
    fontSize: "16px",
    lineHeight: "24px",
    margin: "0 0 16px",
    textAlign: "center" as const,
  },
  codeContainer: {
    backgroundColor: "#f6f9fc",
    borderRadius: "8px",
    padding: "24px",
    margin: "24px 0",
    textAlign: "center" as const,
  },
  code: {
    color: "#1a1a1a",
    fontSize: "32px",
    fontWeight: "700" as const,
    letterSpacing: "8px",
    margin: "0",
    fontFamily: "monospace",
  },
  subtext: {
    color: "#666",
    fontSize: "14px",
    lineHeight: "20px",
    margin: "0",
    textAlign: "center" as const,
  },
};
