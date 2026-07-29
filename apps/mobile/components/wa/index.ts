/**
 * WhatsApp-shell component kit — barrel export.
 *
 * See `docs/plans/church-migration-ui-redesign/WHATSAPP-DESIGN-SYSTEM.md` for
 * the spec these implement. Import metrics constants from `./metrics` rather
 * than re-typing raw numbers on a surface.
 */
export { WaRow } from './WaRow';
export type { WaRowProps, WaRowAvatarProp, WaRowAvatarDescriptor } from './WaRow';

export { WaSeparator } from './WaSeparator';
export type { WaSeparatorProps } from './WaSeparator';

export { WaInsetGroup } from './WaInsetGroup';
export type { WaInsetGroupProps } from './WaInsetGroup';

export { WaCell } from './WaCell';
export type { WaCellProps, WaCellVariant } from './WaCell';

export { WaScreenHeader, WaSubScreenHeader } from './WaScreenHeader';
export type {
  WaScreenHeaderProps,
  WaSubScreenHeaderProps,
  WaHeaderButton,
} from './WaScreenHeader';

export { WaFloatingButton } from './WaFloatingButton';
export type { WaFloatingButtonProps, WaFloatingButtonVariant } from './WaFloatingButton';

export { WaLargeTitle } from './WaLargeTitle';
export type { WaLargeTitleProps } from './WaLargeTitle';

export { WaTabBar } from './WaTabBar';
export type { WaTabBarProps } from './WaTabBar';

export { WaDayPill } from './WaDayPill';
export type { WaDayPillProps } from './WaDayPill';

export { WaBadge } from './WaBadge';
export type { WaBadgeProps } from './WaBadge';

export { WaSectionLabel } from './WaSectionLabel';
export type { WaSectionLabelProps } from './WaSectionLabel';

export * from './metrics';
