import { useState, useRef, useEffect, type FormEvent } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useWebAuth } from "../hooks/useWebAuth";

type Step = "phone" | "code";

/**
 * Format a raw digit string as a US phone number: (xxx) xxx-xxxx
 */
function formatPhoneDisplay(digits: string): string {
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

export default function SignIn() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get("redirect") || "/onboarding/proposal";

  const { signIn } = useWebAuth();

  // Step management
  const [step, setStep] = useState<Step>("phone");

  // Phone step state
  const [phoneDigits, setPhoneDigits] = useState("");
  const [phoneSending, setPhoneSending] = useState(false);
  const [phoneError, setPhoneError] = useState("");

  // Code step state
  const [codeDigits, setCodeDigits] = useState(["", "", "", "", "", ""]);
  const [codeVerifying, setCodeVerifying] = useState(false);
  const [codeError, setCodeError] = useState("");

  // Refs for OTP input auto-focus
  const codeInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Convex actions
  const sendOtp = useAction(api.functions.auth.phoneOtp.sendPhoneOTP);
  const verifyOtp = useAction(api.functions.auth.phoneOtp.verifyPhoneOTP);

  // Focus first OTP input when switching to code step
  useEffect(() => {
    if (step === "code") {
      codeInputRefs.current[0]?.focus();
    }
  }, [step]);

  // ---- Phone step handlers ----

  function handlePhoneInput(value: string) {
    // Strip everything except digits
    const digits = value.replace(/\D/g, "");
    // Limit to 10 digits (US phone without country code)
    setPhoneDigits(digits.slice(0, 10));
    setPhoneError("");
  }

  async function handleSendCode(e: FormEvent) {
    e.preventDefault();
    if (phoneDigits.length !== 10) {
      setPhoneError("Please enter a valid 10-digit phone number.");
      return;
    }

    setPhoneSending(true);
    setPhoneError("");

    try {
      await sendOtp({ phone: `+1${phoneDigits}` });
      setStep("code");
    } catch (err) {
      setPhoneError(
        err instanceof Error ? err.message : "Failed to send code. Please try again."
      );
    } finally {
      setPhoneSending(false);
    }
  }

  // ---- Code step handlers ----

  function handleCodeInput(index: number, value: string) {
    // Only allow single digit
    const digit = value.replace(/\D/g, "").slice(-1);
    const newDigits = [...codeDigits];
    newDigits[index] = digit;
    setCodeDigits(newDigits);
    setCodeError("");

    // Auto-advance to next input
    if (digit && index < 5) {
      codeInputRefs.current[index + 1]?.focus();
    }
  }

  function handleCodeKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === "Backspace" && !codeDigits[index] && index > 0) {
      // Move back on backspace when current field is empty
      codeInputRefs.current[index - 1]?.focus();
    }
  }

  function handleCodePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length === 0) return;

    const newDigits = [...codeDigits];
    for (let i = 0; i < 6; i++) {
      newDigits[i] = pasted[i] || "";
    }
    setCodeDigits(newDigits);

    // Focus the next empty field, or the last one
    const nextEmpty = newDigits.findIndex((d) => !d);
    const focusIndex = nextEmpty === -1 ? 5 : nextEmpty;
    codeInputRefs.current[focusIndex]?.focus();
  }

  async function handleVerifyCode(e: FormEvent) {
    e.preventDefault();
    const code = codeDigits.join("");
    if (code.length !== 6) {
      setCodeError("Please enter the full 6-digit code.");
      return;
    }

    setCodeVerifying(true);
    setCodeError("");

    try {
      const result = await verifyOtp({
        phone: `+1${phoneDigits}`,
        code,
      });

      if (!result.verified) {
        setCodeError("Verification failed. Please try again.");
        return;
      }

      if (result.access_token) {
        signIn(result.access_token, result.refresh_token);
        navigate(redirect, { replace: true });
      } else if (result.phoneVerificationToken) {
        // New user -- no account yet. Redirect to proposal page
        // with the verification token so they can complete signup.
        navigate(
          `/onboarding/proposal?phoneVerificationToken=${encodeURIComponent(result.phoneVerificationToken)}&phone=${encodeURIComponent(`+1${phoneDigits}`)}`,
          { replace: true }
        );
      } else {
        setCodeError("Something went wrong. Please try again.");
      }
    } catch (err) {
      setCodeError(
        err instanceof Error ? err.message : "Invalid code. Please try again."
      );
    } finally {
      setCodeVerifying(false);
    }
  }

  function handleBackToPhone() {
    setStep("phone");
    setCodeDigits(["", "", "", "", "", ""]);
    setCodeError("");
  }

  // ---- Render ----

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-primary-100 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Card */}
        <div className="bg-white rounded-2xl shadow-lg shadow-neutral-200/50 border border-neutral-200/60 p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <Link to="/" className="inline-block mb-4">
              <h1 className="text-3xl font-bold text-neutral-900 tracking-tight">
                Togather
              </h1>
            </Link>
            <p className="text-neutral-500 text-sm">
              {step === "phone"
                ? "Sign in with your phone number"
                : `Enter the code sent to +1 ${formatPhoneDisplay(phoneDigits)}`}
            </p>
          </div>

          {/* Phone Step */}
          {step === "phone" && (
            <form onSubmit={handleSendCode} className="space-y-5">
              <div>
                <label
                  htmlFor="phone"
                  className="block text-sm font-medium text-neutral-700 mb-1.5"
                >
                  Phone number
                </label>
                <div className="flex">
                  <span className="inline-flex items-center px-3.5 rounded-l-lg border border-r-0 border-neutral-300 bg-neutral-50 text-neutral-500 text-sm select-none">
                    +1
                  </span>
                  <input
                    id="phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    autoFocus
                    value={formatPhoneDisplay(phoneDigits)}
                    onChange={(e) => handlePhoneInput(e.target.value)}
                    placeholder="(555) 555-5555"
                    className="flex-1 block w-full rounded-r-lg border border-neutral-300 px-3.5 py-2.5 text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500 text-sm"
                  />
                </div>
                {phoneError && (
                  <p className="mt-2 text-sm text-red-600">{phoneError}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={phoneSending || phoneDigits.length !== 10}
                className="w-full rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500/40 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {phoneSending ? "Sending..." : "Send verification code"}
              </button>
            </form>
          )}

          {/* Code Step */}
          {step === "code" && (
            <form onSubmit={handleVerifyCode} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-3">
                  Verification code
                </label>
                <div className="flex gap-2 justify-center" onPaste={handleCodePaste}>
                  {codeDigits.map((digit, i) => (
                    <input
                      key={i}
                      ref={(el) => {
                        codeInputRefs.current[i] = el;
                      }}
                      type="text"
                      inputMode="numeric"
                      autoComplete={i === 0 ? "one-time-code" : "off"}
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleCodeInput(i, e.target.value)}
                      onKeyDown={(e) => handleCodeKeyDown(i, e)}
                      className="w-11 h-12 text-center text-lg font-semibold rounded-lg border border-neutral-300 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500"
                    />
                  ))}
                </div>
                {codeError && (
                  <p className="mt-3 text-sm text-red-600 text-center">
                    {codeError}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={
                  codeVerifying || codeDigits.some((d) => !d)
                }
                className="w-full rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500/40 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {codeVerifying ? "Verifying..." : "Verify"}
              </button>

              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  onClick={handleBackToPhone}
                  className="text-neutral-500 hover:text-neutral-700"
                >
                  Change number
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setCodeError("");
                    try {
                      await sendOtp({ phone: `+1${phoneDigits}` });
                    } catch (err) {
                      setCodeError(
                        err instanceof Error
                          ? err.message
                          : "Failed to resend. Please try again."
                      );
                    }
                  }}
                  className="text-primary-600 hover:text-primary-700 font-medium"
                >
                  Resend code
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-neutral-400 mt-6">
          By continuing, you agree to our{" "}
          <Link to="/legal/terms" className="underline hover:text-neutral-600">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link to="/legal/privacy" className="underline hover:text-neutral-600">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
