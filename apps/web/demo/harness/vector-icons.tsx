/**
 * Stub of @expo/vector-icons for the demo bundle. Renders a small inline SVG for
 * the glyphs the demo screens use (font-based icon loading isn't set up here).
 * Unknown names render an empty box of the right size so layout is preserved.
 */
import type { CSSProperties } from "react";

type IconProps = { name?: string; size?: number; color?: string; style?: CSSProperties };

function glyph(name: string, color: string) {
  switch (name) {
    case "search":
      return (
        <>
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </>
      );
    case "chevron-forward":
      return <polyline points="9 6 15 12 9 18" />;
    case "chevron-back":
      return <polyline points="15 6 9 12 15 18" />;
    case "checkmark-circle":
      return (
        <>
          <circle cx="12" cy="12" r="10" fill={color} stroke="none" />
          <polyline points="7.5 12.5 10.5 15.5 16.5 9" stroke="#fff" />
        </>
      );
    case "exit-outline":
    case "log-out-outline":
      return (
        <>
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </>
      );
    case "warning":
      return (
        <>
          <path d="M12 3 L22 20 H2 Z" />
          <line x1="12" y1="9" x2="12" y2="14" />
          <line x1="12" y1="17" x2="12" y2="17" />
        </>
      );
    case "close":
      return (
        <>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </>
      );
    case "add":
      return (
        <>
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </>
      );
    case "add-circle-outline":
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <line x1="12" y1="8" x2="12" y2="16" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </>
      );
    case "heart":
      return <path d="M12 21s-7-4.5-9.5-9A5 5 0 0 1 12 6a5 5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z" fill={color} stroke="none" />;
    case "heart-outline":
      return <path d="M12 21s-7-4.5-9.5-9A5 5 0 0 1 12 6a5 5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z" />;
    case "checkmark":
      return <polyline points="5 12.5 10 17.5 19 7" />;
    case "ellipsis-horizontal":
      return (
        <>
          <circle cx="5" cy="12" r="1.4" fill={color} stroke="none" />
          <circle cx="12" cy="12" r="1.4" fill={color} stroke="none" />
          <circle cx="19" cy="12" r="1.4" fill={color} stroke="none" />
        </>
      );
    case "people-outline":
      return (
        <>
          <circle cx="9" cy="8" r="3" />
          <path d="M3 20a6 6 0 0 1 12 0" />
          <path d="M16 5a3 3 0 0 1 0 6" />
          <path d="M21 20a6 6 0 0 0-3-5.2" />
        </>
      );
    case "flame":
      return <path d="M12 3c1 3 4 4 4 8a4 4 0 0 1-8 0c0-2 1-3 2-4 0 1 .5 2 1 2 0-2 1-4 1-6z" fill={color} stroke="none" />;
    case "eye-off-outline":
      return (
        <>
          <path d="M3 3l18 18" />
          <path d="M10.6 6.1A9 9 0 0 1 21 12a9.5 9.5 0 0 1-3 3.6M6 6.5A9.5 9.5 0 0 0 3 12a9 9 0 0 0 9 5 8.6 8.6 0 0 0 3-.5" />
        </>
      );
    default:
      return <rect x="4" y="4" width="16" height="16" rx="3" />;
  }
}

function makeIconFamily() {
  const Icon = ({ name = "", size = 24, color = "currentColor", style }: IconProps) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      {glyph(name, color)}
    </svg>
  );
  Icon.glyphMap = {} as Record<string, number>;
  return Icon;
}

export const Ionicons = makeIconFamily();
export const MaterialIcons = makeIconFamily();
export const MaterialCommunityIcons = makeIconFamily();
export const Feather = makeIconFamily();
export const FontAwesome = makeIconFamily();
export const FontAwesome5 = makeIconFamily();
export const AntDesign = makeIconFamily();
export const Entypo = makeIconFamily();
export const Octicons = makeIconFamily();

export default { Ionicons, MaterialIcons, Feather };
