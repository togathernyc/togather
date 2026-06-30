/**
 * Community landing page — connect-card OCR via OpenAI vision.
 *
 * Admins photograph a paper "connect card" / "gold card" and we extract the
 * handwritten/printed fields so the landing page form can be pre-filled. The
 * admin always reviews and confirms before the form is submitted — this only
 * suggests values, it never submits anything.
 *
 * Uses OpenAI's `gpt-4o` (vision) because we already have `OPENAI_SECRET_KEY`
 * configured (also used by `functions/posters.ts` keywording and the prayer
 * moderator). gpt-4o reads handwriting noticeably better than gpt-4o-mini,
 * which matters for hand-filled cards.
 *
 * Contract: the caller passes the image as a data URL plus the list of custom
 * form fields the community has configured. We return only the fields we can
 * read off the card; anything illegible or absent is simply omitted.
 */

import { ConvexError } from "convex/values";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o";
const REQUEST_TIMEOUT_MS = 45_000;

/** A community-configured custom field we may be able to read off the card. */
export interface CustomFieldSpec {
  /** Stable slot key when present, otherwise the human label is the key. */
  slot?: string;
  label: string;
  /** "text" | "number" | "dropdown" | "multiselect" | "boolean" | ... */
  type: string;
  options?: string[];
}

export interface ExtractedLandingFields {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  zipCode?: string;
  /** MM/DD/YYYY to match the landing form's birthday input. */
  dateOfBirth?: string;
  /** Custom fields keyed by their configured label. */
  customFields?: Array<{ label: string; value: string }>;
}

/**
 * Build the system prompt. Kept as a function so the custom-field section can
 * describe exactly which labels (and dropdown options) the model may use.
 */
export function buildSystemPrompt(customFields: CustomFieldSpec[]): string {
  const lines: string[] = [
    "You are an OCR assistant for a community (church) connect card.",
    "You are given a photo of a paper card a newcomer filled out by hand or that was printed.",
    "Read the card and extract the visitor's details to pre-fill a digital form.",
    "",
    "Extract these built-in fields when present:",
    "- firstName, lastName: the person's name.",
    "- phone: their phone number, digits only or in (555) 555-5555 form.",
    "- email: their email address.",
    "- zipCode: a US ZIP code (5 digits, optionally ZIP+4).",
    "- dateOfBirth: their birthday formatted strictly as MM/DD/YYYY.",
  ];

  const usableCustom = customFields.filter(
    (f) => f.label && !["section_header", "subtitle", "button"].includes(f.type)
  );
  if (usableCustom.length > 0) {
    lines.push(
      "",
      "Also extract these custom fields if their value appears on the card.",
      'Return them in a "customFields" array of {"label","value"} objects,',
      "using the EXACT label text shown below:"
    );
    for (const f of usableCustom) {
      let desc = `- "${f.label}" (${f.type})`;
      if (f.type === "boolean") {
        desc += ' — value should be "true" or "false"';
      } else if (
        (f.type === "dropdown" || f.type === "multiselect") &&
        f.options?.length
      ) {
        desc += ` — choose from: ${f.options.join(", ")}`;
        if (f.type === "multiselect") {
          desc += " (separate multiple with a semicolon)";
        }
      }
      lines.push(desc);
    }
  }

  lines.push(
    "",
    "Rules:",
    "- Only include a field when you can actually read its value on the card.",
    "- Omit any field that is blank, illegible, or not present. Do not guess.",
    "- Do not invent data. An empty form is better than a wrong value.",
    "",
    "Respond with strict JSON only, in this shape:",
    '{"firstName"?:string,"lastName"?:string,"phone"?:string,"email"?:string,"zipCode"?:string,"dateOfBirth"?:string,"customFields"?:[{"label":string,"value":string}]}'
  );

  return lines.join("\n");
}

/**
 * Parse and normalize the model's JSON response. Pure (no network) so it can be
 * unit-tested. Unknown/empty values are dropped; custom fields are filtered to
 * the configured labels.
 */
export function parseExtractionResponse(
  raw: string | null | undefined,
  customFields: CustomFieldSpec[]
): ExtractedLandingFields {
  if (!raw) return {};

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};

  const result: ExtractedLandingFields = {};

  const str = (v: unknown): string | undefined => {
    if (typeof v !== "string") return undefined;
    const t = v.trim();
    return t.length > 0 ? t : undefined;
  };

  const firstName = str(parsed.firstName);
  if (firstName) result.firstName = firstName;
  const lastName = str(parsed.lastName);
  if (lastName) result.lastName = lastName;
  const phone = str(parsed.phone);
  if (phone) result.phone = phone;
  const email = str(parsed.email);
  if (email) result.email = email;
  const zipCode = str(parsed.zipCode);
  if (zipCode) result.zipCode = zipCode;
  const dateOfBirth = str(parsed.dateOfBirth);
  if (dateOfBirth) result.dateOfBirth = dateOfBirth;

  // Custom fields: keep only entries whose label maps to a configured field.
  const validLabels = new Set(
    customFields.map((f) => f.label).filter((l): l is string => !!l)
  );
  const rawCustom = parsed.customFields;
  if (Array.isArray(rawCustom) && validLabels.size > 0) {
    const seen = new Set<string>();
    const customFieldsOut: Array<{ label: string; value: string }> = [];
    for (const entry of rawCustom) {
      if (!entry || typeof entry !== "object") continue;
      const label = str((entry as Record<string, unknown>).label);
      const value = str((entry as Record<string, unknown>).value);
      if (!label || !value) continue;
      if (!validLabels.has(label) || seen.has(label)) continue;
      seen.add(label);
      customFieldsOut.push({ label, value });
    }
    if (customFieldsOut.length > 0) result.customFields = customFieldsOut;
  }

  return result;
}

/**
 * Call OpenAI vision to read a connect card. `imageDataUrl` is a
 * `data:image/...;base64,...` URL. Throws on a missing key or a non-OK
 * response so the caller can surface a clear error to the admin.
 */
export async function extractLandingFields(
  imageDataUrl: string,
  customFields: CustomFieldSpec[]
): Promise<ExtractedLandingFields> {
  const apiKey = process.env.OPENAI_SECRET_KEY;
  if (!apiKey) {
    console.error("[landingFormVision] OPENAI_SECRET_KEY not configured");
    // ConvexError so the admin sees a real message (plain Errors are redacted
    // to a generic "Server Error" on the client in production).
    throw new ConvexError("Photo autofill is unavailable right now.");
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
          { role: "system", content: buildSystemPrompt(customFields) },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract the visitor details from this connect card as JSON.",
              },
              { type: "image_url", image_url: { url: imageDataUrl } },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      console.error(
        `[landingFormVision] OpenAI vision error ${response.status}: ${errBody.slice(0, 300)}`
      );
      throw new ConvexError(
        "Couldn't read the card. Please try again with a clearer photo."
      );
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json?.choices?.[0]?.message?.content ?? null;
    return parseExtractionResponse(content, customFields);
  } finally {
    clearTimeout(timeoutId);
  }
}
