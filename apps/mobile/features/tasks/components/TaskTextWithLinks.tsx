import React from "react";
import { Linking, Text, type TextStyle } from "react-native";
import { URL_REGEX } from "../../chat/utils/eventLinkUtils";

type Props = {
  text: string;
  baseStyle?: TextStyle;
  linkStyle?: TextStyle;
};

/**
 * Renders plain text with http(s) URLs as tappable links (same URL rules as chat).
 */
export function TaskTextWithLinks({ text, baseStyle, linkStyle }: Props) {
  if (!text) return null;

  const segments: Array<{ type: "text" | "url"; value: string }> = [];
  let last = 0;
  const re = new RegExp(URL_REGEX.source, URL_REGEX.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      segments.push({ type: "text", value: text.slice(last, match.index) });
    }
    segments.push({ type: "url", value: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    segments.push({ type: "text", value: text.slice(last) });
  }

  return (
    <Text style={baseStyle}>
      {segments.map((seg, i) =>
        seg.type === "url" ? (
          <Text
            key={`u-${i}-${seg.value.slice(0, 24)}`}
            style={linkStyle}
            onPress={() => void Linking.openURL(seg.value)}
          >
            {seg.value}
          </Text>
        ) : (
          seg.value
        ),
      )}
    </Text>
  );
}
