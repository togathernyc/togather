/**
 * Pure decision logic for whether a grouped inbox row's channel sub-rows
 * (secondary channels + the "N more channels" row) should render, given the
 * group's persisted collapsed state (`stores/inboxGroupCollapse.ts`).
 *
 * Extracted out of `GroupedInboxItem` so this can be unit-tested without
 * mounting the component (which pulls in auth/theme/prefetch hooks).
 */
export interface ChannelRowsVisibility {
  /** Whether the secondary channel sub-rows should render at all. */
  showSecondaryChannels: boolean;
  /** Whether the "N more channels" overflow row should render. */
  showMoreChannelsRow: boolean;
}

export function computeChannelRowsVisibility(params: {
  /** Whether this group has more than one channel (a cluster header). */
  canExpand: boolean;
  /** Whether the user has collapsed this group's channel rows. */
  isCollapsed: boolean;
  /** Channels hidden by the cluster cap/mute rules, awaiting the "N more" row. */
  hiddenChannelCount: number;
}): ChannelRowsVisibility {
  const showSecondaryChannels = params.canExpand && !params.isCollapsed;
  return {
    showSecondaryChannels,
    showMoreChannelsRow: showSecondaryChannels && params.hiddenChannelCount > 0,
  };
}
