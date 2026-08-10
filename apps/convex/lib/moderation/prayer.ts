/**
 * Prayer request moderation — tiered Green/Yellow/Red.
 *
 * Currently uses OpenAI's `gpt-4o-mini` because we already have
 * `OPENAI_SECRET_KEY` configured (also used by `functions/posters.ts`).
 *
 * Provider swap: if/when cost becomes a problem, flip `PROVIDER` below to
 * `"ollama"` and set `OLLAMA_API_KEY`. Both branches conform to the same
 * OpenAI-style chat-completions JSON contract; the rest of the system
 * (prayers.ts, the rejection UI) stays untouched. See ollama.com/pricing.
 *
 * Tier philosophy (informed by 7 Cups + Crisis Text Line research):
 *
 * - **GREEN**: publish. Optionally `crisis: true` — first-person language
 *   that suggests struggle (depression, suicidal ideation without plan/
 *   means/timeframe). We DO NOT block this content; we publish it and the
 *   client overlays crisis-resource info ("triage, not suppression").
 *
 * - **YELLOW**: hold for a human community admin to review. Borderline
 *   content where context matters more than text — third-party named with
 *   identifying detail, borderline solicitation, accusations against a
 *   real person.
 *
 * - **RED**: reject. Clear policy violations — graphic violence/sexual
 *   content, an explicit suicide plan with means + timeframe, slurs,
 *   doxing of named third parties, obvious spam/MLM.
 *
 * Fail-open: any error returns GREEN. Better to ship a request that might
 * need cleanup than to block a vulnerable user from asking for prayer.
 */

type Provider = "openai" | "ollama";
const PROVIDER: Provider = "openai";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o-mini";

const OLLAMA_URL = "https://ollama.com/api/chat";
const OLLAMA_MODEL = "gpt-oss:20b";

const REQUEST_TIMEOUT_MS = 30_000;

export type Severity = "green" | "yellow" | "red";

export type ModerationCategory =
  // RED categories
  | "violence"
  | "self_harm_plan"
  | "explicit"
  | "doxing"
  | "hate"
  | "spam"
  // YELLOW categories
  | "third_party_named"
  | "intimate_explicit"
  | "borderline_solicitation"
  | "borderline_other"
  // catch-all
  | "other";

export interface ModerationResult {
  severity: Severity;
  /** First-person mental-health struggle that warrants a resource card. */
  crisis: boolean;
  /** Why this severity was chosen. Only meaningful when severity != green. */
  category?: ModerationCategory;
  /** Short admin-facing note explaining the YELLOW judgment, e.g. "Names
   * 'Mike' alongside an accusation of abuse." Empty for GREEN/RED. */
  note?: string;
}

const SYSTEM_PROMPT = `You are a moderator for a community prayer-request app used by churches. Decide how to handle a prayer request.

Return a tier: GREEN (publish), YELLOW (hold for human admin review), or RED (reject). Separately, flag CRISIS when the author describes their own mental-health struggle.

# Tiers

## GREEN — publish

Allow requests for: health, family, work, faith, grief, addiction recovery, relationships, financial hardship, parenting struggles, asks for guidance/wisdom, mental-health struggles spoken in the FIRST PERSON without a plan + means + timeframe.

Examples:
- "Pray for my mom's recovery from surgery this week."
- "Asking for prayers — I'm exhausted and overwhelmed."
- "I've been struggling with depression. Please pray I keep showing up."  ← GREEN + crisis: true
- "I don't want to be here anymore."  ← GREEN + crisis: true (no plan/means stated)
- "Pray for our youth group mission trip."

## YELLOW — hold for admin review

Hold when the post is borderline and a human admin should make the call. Specifically:
- **Third-party named with identifying detail AND an accusation, complaint, or sensitive disclosure** — naming someone publicly in a way that exposes them. ("Please pray for my husband Mark — he's been struggling with a porn addiction and lying about it.") The fact that it's a real name + a sensitive disclosure makes this a privacy/defamation risk even without bad intent.
- **Intimate / explicit disclosures, even when sincere** (category: \`intimate_explicit\`) — first-person posts that mention specifics of one's own sex life, sexual struggles, masturbation, pornography use, or other bedroom-intimacy detail. These are usually well-intentioned but too detailed for a public community prayer wall. Example: "My wife and I are having a hard time in our sex life, we are praying for a spark." → YELLOW. (A general "pray for our marriage" stays GREEN.) The admin can approve as-is or reject so the author can rephrase.
- **Borderline solicitation** — mentions a fundraiser, GoFundMe, business product, or "DM me to learn more" but is wrapped in a sincere prayer request. Pure asks for prayer about financial hardship are GREEN.
- **Borderline proselytizing** — "Pray that everyone in our community recognizes [specific doctrine/denomination is the only truth]". Generic asks for faith/wisdom are GREEN.
- **Anything you genuinely cannot decide between GREEN and RED.**

Note: a real name BY ITSELF — "Pray for Mike" or "Pray for my sister Sarah's cancer treatment" — is GREEN. Our compose UI nudges users away from names at submit time; if they posted with a name anyway, the moderator's job is only to catch the *accusation + name* combination (or other YELLOW criteria above), not the name alone.

## RED — reject

Reject only when clearly policy-violating:
- Graphic violence or sexual content (gratuitous, not a clinical health mention).
- Explicit suicide/self-harm PLAN — names a method AND access to means AND a timeframe.
- Doxing — third party's full name + address/phone/employer/identifying details + accusatory framing.
- Slurs or targeted hate against protected groups.
- Obvious spam: MLM recruiting, GoFundMe-only post with no prayer ask, copy-pasted promotional text, scams.

# Crisis flag (independent of tier)

Set crisis: true when the author describes their OWN mental-health struggle in first person — depression, suicidal thoughts, self-harm ideation, severe anxiety, addiction relapse, abuse they're enduring. The flag fires for GREEN content too; it does NOT block. It triggers a 988/Crisis Text Line resource card on the rendered prayer. Err on the side of true.

DO NOT set crisis: true for third-party requests ("pray for my brother who is depressed") — the resource overlay only makes sense for the author themselves.

# Default

When in doubt, prefer GREEN over YELLOW, and YELLOW over RED. Prayer requests are often vulnerable; the cost of blocking is high.

# Output

Respond with strict JSON ONLY:
{"severity": "green" | "yellow" | "red", "crisis": boolean, "category"?: "violence" | "self_harm_plan" | "explicit" | "doxing" | "hate" | "spam" | "third_party_named" | "intimate_explicit" | "borderline_solicitation" | "borderline_other" | "other", "note"?: string}

- For GREEN, omit category and note.
- For YELLOW, include category and a short note (≤ 120 chars) the admin can read.
- For RED, include category. Note optional.`;

export async function moderatePrayerText(text: string): Promise<ModerationResult> {
  try {
    const content =
      PROVIDER === "openai" ? await callOpenAI(text) : await callOllama(text);
    if (!content) return { severity: "green", crisis: false };

    const parsed = JSON.parse(content) as Partial<ModerationResult>;
    const severity: Severity =
      parsed.severity === "yellow" || parsed.severity === "red"
        ? parsed.severity
        : "green";
    const crisis = parsed.crisis === true;
    const result: ModerationResult = { severity, crisis };
    if (parsed.category) result.category = parsed.category as ModerationCategory;
    if (parsed.note) result.note = String(parsed.note).slice(0, 240);
    return result;
  } catch (err) {
    console.error("[moderatePrayerText] error:", err);
    return { severity: "green", crisis: false };
  }
}

async function callOpenAI(userText: string): Promise<string | null> {
  const apiKey = process.env.OPENAI_SECRET_KEY;
  if (!apiKey) {
    console.warn("[moderatePrayerText] OPENAI_SECRET_KEY not set, allowing by default");
    return null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        response_format: { type: "json_object" },
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userText },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      console.error(
        `[moderatePrayerText] OpenAI ${response.status}: ${errBody.slice(0, 200)}`,
      );
      return null;
    }
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return json?.choices?.[0]?.message?.content?.trim() ?? null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callOllama(userText: string): Promise<string | null> {
  const apiKey = process.env.OLLAMA_API_KEY;
  if (!apiKey) {
    console.warn("[moderatePrayerText] OLLAMA_API_KEY not set, allowing by default");
    return null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        format: "json",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userText },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      console.error(
        `[moderatePrayerText] Ollama ${response.status}: ${errBody.slice(0, 200)}`,
      );
      return null;
    }
    const json = (await response.json()) as { message?: { content?: string } };
    return json?.message?.content?.trim() ?? null;
  } finally {
    clearTimeout(timeoutId);
  }
}
