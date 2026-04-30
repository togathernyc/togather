import { StyleSheet } from 'react-native';

/**
 * Shared section primitives used across group-page surfaces (member +
 * non-member views) so spacing stays consistent. Each "section" is a
 * 12px-inset wrapper with a small uppercase header and an inner
 * surface-secondary card. Tappable footers (e.g. "View all members")
 * sit inside the same card with a hairline top border.
 *
 * Color is applied at callsite via `useTheme()` — these are layout-only.
 */
export const sectionStyles = StyleSheet.create({
  section: {
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 8,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
    marginBottom: 8,
    paddingHorizontal: 8,
  },
  card: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  viewAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  viewAllText: {
    fontSize: 15,
    fontWeight: '500',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 48,
  },
  detailText: {
    flex: 1,
    fontSize: 15,
  },
});
