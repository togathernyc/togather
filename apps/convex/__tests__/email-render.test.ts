import { describe, expect, it } from "vitest";
import { render } from "@react-email/render";
import {
  VerificationCodeEmail,
  verificationCodeSubject,
} from "../lib/email/templates/VerificationCode";

/**
 * Runtime backstop for the react/react-dom version pairing.
 *
 * The verification email is the only backend code path that executes
 * react-dom (via @react-email/render -> react-dom/server), and react-dom
 * hard-errors at render time if `react` and `react-dom` resolve to different
 * exact versions (React 19's ensureCorrectIsomorphicReactVersion — present in
 * 19.1.0's server builds too). That skew is invisible to typecheck and every
 * non-rendering test — it shipped to production once, when the load-bearing
 * react pin in apps/convex/package.json re-keyed the react-email tree onto
 * react@19.1.0 while react-dom (then undeclared, auto-installed as a
 * transitive peer) stayed at 19.2.4.
 *
 * Both react AND react-dom are now pinned to the same exact version in
 * apps/convex/package.json, and check-react-consistency's lockfile gate guards
 * the pairing statically. This test is the belt to that suspenders: it renders
 * the real template through the real react-dom, so any future skew (or any
 * other regression that breaks email rendering) fails CI instead of the login
 * flow.
 */
describe("verification email rendering", () => {
  it("renders the OTP template through react-dom/server", async () => {
    const html = await render(
      VerificationCodeEmail({ code: "123456", email: "test@example.com" })
    );

    expect(html).toContain("123456");
    expect(html).toContain("test@example.com");
    expect(html).toContain("Verify your email");
  });

  it("exports a non-empty subject", () => {
    expect(verificationCodeSubject.length).toBeGreaterThan(0);
  });
});
