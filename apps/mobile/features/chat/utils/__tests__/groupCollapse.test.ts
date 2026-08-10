import { computeChannelRowsVisibility } from "../groupCollapse";

describe("computeChannelRowsVisibility", () => {
  it("shows secondary channels for a multi-channel group by default (expanded)", () => {
    expect(
      computeChannelRowsVisibility({
        canExpand: true,
        isCollapsed: false,
        hiddenChannelCount: 0,
      }),
    ).toEqual({ showSecondaryChannels: true, showMoreChannelsRow: false });
  });

  it("hides all channel rows, including the 'N more' row, once collapsed", () => {
    expect(
      computeChannelRowsVisibility({
        canExpand: true,
        isCollapsed: true,
        hiddenChannelCount: 3,
      }),
    ).toEqual({ showSecondaryChannels: false, showMoreChannelsRow: false });
  });

  it("shows the 'N more' row only when channels are hidden by the cap", () => {
    expect(
      computeChannelRowsVisibility({
        canExpand: true,
        isCollapsed: false,
        hiddenChannelCount: 2,
      }),
    ).toEqual({ showSecondaryChannels: true, showMoreChannelsRow: true });
  });

  it("never shows sub-rows for a single-channel group, collapsed or not", () => {
    expect(
      computeChannelRowsVisibility({
        canExpand: false,
        isCollapsed: false,
        hiddenChannelCount: 0,
      }),
    ).toEqual({ showSecondaryChannels: false, showMoreChannelsRow: false });

    expect(
      computeChannelRowsVisibility({
        canExpand: false,
        isCollapsed: true,
        hiddenChannelCount: 0,
      }),
    ).toEqual({ showSecondaryChannels: false, showMoreChannelsRow: false });
  });
});
