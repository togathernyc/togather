/**
 * WhatsApp-shell chat-surface tokens (WA-VISUAL-DELTAS.md §S4).
 *
 * The chat room paints one wallpaper layer behind everything (see
 * `components/ChatWallpaper.tsx`), so its chrome — nav bar, channel tab strip,
 * leader-tool pills, composer — is *translucent over the wallpaper* rather
 * than opaque surface fills. Those alpha fills can't come from
 * `theme/colors.ts` (whose tokens are opaque and shared with flag-off
 * surfaces), so they live here, next to the only feature that uses them.
 *
 * Everything in this module is referenced exclusively from
 * `whatsappShellEnabled` branches — flag-off rendering never reads it.
 */

/** §S4.2 "incoming white" bubble + composer field fill. */
export const WA_CHAT_FIELD_LIGHT = '#FFFFFF';
export const WA_CHAT_FIELD_DARK = '#1F2C34';

/**
 * §2.2 "translucent near-white bar over the wallpaper" — the chat-room nav
 * header and channel tab strip. Alpha lets the doodle pattern read faintly
 * through, which is what makes the bar look layered rather than opaque.
 */
export const WA_CHAT_CHROME_LIGHT = 'rgba(247, 245, 242, 0.92)';
export const WA_CHAT_CHROME_DARK = 'rgba(17, 27, 33, 0.92)';

/** §S4.6 composer bar: "translucent light bar over wallpaper (rgba fill, no hairline)". */
export const WA_COMPOSER_BAR_LIGHT = 'rgba(247, 245, 242, 0.86)';
export const WA_COMPOSER_BAR_DARK = 'rgba(17, 27, 33, 0.86)';

/** §2.3 neutral channel tab strip: white active pill on a light-gray track. */
export const WA_TAB_TRACK_LIGHT = 'rgba(0, 0, 0, 0.05)';
export const WA_TAB_TRACK_DARK = 'rgba(255, 255, 255, 0.08)';
export const WA_TAB_ACTIVE_LIGHT = '#FFFFFF';
export const WA_TAB_ACTIVE_DARK = '#2A3942';

/** §S4.2 "WA bubbles have a ~1px soft drop shadow". */
export const WA_BUBBLE_SHADOW = {
  shadowColor: '#000',
  shadowOpacity: 0.13,
  shadowRadius: 1,
  shadowOffset: { width: 0, height: 1 },
  elevation: 1,
} as const;

/** §S4.2 bubble body copy / in-bubble sender name / in-bubble timestamp. */
export const WA_BUBBLE_BODY_SIZE = 16;
export const WA_BUBBLE_BODY_LINE_HEIGHT = 21;
export const WA_BUBBLE_SENDER_SIZE = 15;
export const WA_BUBBLE_TIMESTAMP_SIZE = 11;

/** §S4.6 composer field: fully-rounded, ~44px tall. */
export const WA_COMPOSER_FIELD_HEIGHT = 44;
export const WA_COMPOSER_FIELD_RADIUS = 22;
