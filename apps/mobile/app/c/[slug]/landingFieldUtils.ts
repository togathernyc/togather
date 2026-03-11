export type LandingFieldLike = {
  type: string;
  showOnLanding?: boolean;
};

export type SubtitleSegment =
  | { type: "text"; text: string }
  | { type: "link"; text: string; url: string };

export const NON_INPUT_FIELD_TYPES = new Set(["section_header", "subtitle", "button"]);

const MARKDOWN_LINK_REGEX = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi;
const URL_REGEX = /(https?:\/\/[^\s]+)/gi;
const TRAILING_PUNCTUATION_REGEX = /[),.;!?]+$/;

function splitPlainTextUrls(text: string): SubtitleSegment[] {
  const segments: SubtitleSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(URL_REGEX)) {
    if (match.index === undefined) continue;
    const rawMatch = match[0];
    let cleanedUrl = rawMatch;
    let trailing = "";

    while (TRAILING_PUNCTUATION_REGEX.test(cleanedUrl)) {
      trailing = cleanedUrl.slice(-1) + trailing;
      cleanedUrl = cleanedUrl.slice(0, -1);
    }

    if (match.index > cursor) {
      segments.push({ type: "text", text: text.slice(cursor, match.index) });
    }
    if (cleanedUrl) {
      segments.push({ type: "link", text: cleanedUrl, url: cleanedUrl });
    }
    if (trailing) {
      segments.push({ type: "text", text: trailing });
    }
    cursor = match.index + rawMatch.length;
  }

  if (cursor < text.length) {
    segments.push({ type: "text", text: text.slice(cursor) });
  }

  return segments.length > 0 ? segments : [{ type: "text", text }];
}

export function parseSubtitleSegments(text: string): SubtitleSegment[] {
  if (!text) return [{ type: "text", text: "" }];

  const segments: SubtitleSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(MARKDOWN_LINK_REGEX)) {
    if (match.index === undefined) continue;
    const fullMatch = match[0];
    const linkText = match[1];
    const linkUrl = match[2];

    if (match.index > cursor) {
      segments.push(...splitPlainTextUrls(text.slice(cursor, match.index)));
    }

    segments.push({
      type: "link",
      text: linkText,
      url: linkUrl,
    });

    cursor = match.index + fullMatch.length;
  }

  if (cursor < text.length) {
    segments.push(...splitPlainTextUrls(text.slice(cursor)));
  }

  return segments;
}

export function isFieldVisibleOnLanding(field: LandingFieldLike): boolean {
  return field.showOnLanding !== false;
}

export function shouldCollectFieldResponse(field: LandingFieldLike): boolean {
  return isFieldVisibleOnLanding(field) && !NON_INPUT_FIELD_TYPES.has(field.type);
}
