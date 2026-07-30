/**
 * useChannelSwitchBuffer unit tests.
 *
 * Fake timers are installed for the whole file (mirroring
 * providers/__tests__/ConnectionProvider.test.tsx) so the hold's 2.5s bound
 * is testable — toggling them per-test leaks into unrelated suites sharing
 * the jest worker.
 */
import React from 'react';
import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { useChannelSwitchBuffer } from '../useChannelSwitchBuffer';

type Msg = { _id: string };

const GENERAL: Msg[] = [{ _id: 'g1' }];
const HELPERS: Msg[] = [{ _id: 'h1' }];

let latest: ReturnType<typeof useChannelSwitchBuffer<Msg>>;

function Probe(props: {
  enabled: boolean;
  channelId: string | null;
  messages: Msg[];
  isLoading: boolean;
}) {
  latest = useChannelSwitchBuffer<Msg>(props as any);
  return <Text>{latest.messages.map((m) => m._id).join(',')}</Text>;
}

function setup(props: {
  enabled?: boolean;
  channelId: string | null;
  messages: Msg[];
  isLoading: boolean;
}) {
  const withDefaults = { enabled: true, ...props };
  const utils = render(<Probe {...withDefaults} />);
  return {
    ...utils,
    update: (next: Partial<typeof withDefaults>) =>
      act(() => {
        utils.rerender(<Probe {...withDefaults} {...next} />);
      }),
  };
}

describe('useChannelSwitchBuffer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('is a pass-through when disabled', () => {
    const { update } = setup({
      enabled: false,
      channelId: 'ch-general',
      messages: GENERAL,
      isLoading: false,
    });

    update({ channelId: 'ch-helpers', messages: [], isLoading: true });
    expect(latest.messages).toEqual([]);
    expect(latest.channelId).toBe('ch-helpers');
    expect(latest.isSwitching).toBe(false);
  });

  it('holds the previous channel while the new one loads', () => {
    const { update } = setup({
      channelId: 'ch-general',
      messages: GENERAL,
      isLoading: false,
    });

    update({ channelId: 'ch-helpers', messages: [], isLoading: true });
    expect(latest.messages).toEqual(GENERAL);
    expect(latest.channelId).toBe('ch-general');
    expect(latest.isSwitching).toBe(true);

    update({ channelId: 'ch-helpers', messages: HELPERS, isLoading: false });
    expect(latest.messages).toEqual(HELPERS);
    expect(latest.channelId).toBe('ch-helpers');
    expect(latest.isSwitching).toBe(false);
  });

  it('repaints a revisited channel from its own buffered page', () => {
    const { update } = setup({
      channelId: 'ch-general',
      messages: GENERAL,
      isLoading: false,
    });
    update({ channelId: 'ch-helpers', messages: HELPERS, isLoading: false });

    update({ channelId: 'ch-general', messages: [], isLoading: true });
    expect(latest.messages).toEqual(GENERAL);
    expect(latest.channelId).toBe('ch-general');
    // Its own content, so fully interactive — not a cross-channel hold.
    expect(latest.isSwitching).toBe(false);
  });

  it('holds the buffered-repaint channel — not the last LIVE one — on the next hop', () => {
    // A live → B live → A revisit (buffered repaint, query still loading) →
    // first-time C. The hold must scenery A (what was on screen), never flash
    // back to B (the last channel that supplied live data).
    const { update } = setup({
      channelId: 'ch-general',
      messages: GENERAL,
      isLoading: false,
    });
    update({ channelId: 'ch-helpers', messages: HELPERS, isLoading: false });
    update({ channelId: 'ch-general', messages: [], isLoading: true });
    expect(latest.channelId).toBe('ch-general');

    update({ channelId: 'ch-new', messages: [], isLoading: true });
    expect(latest.isSwitching).toBe(true);
    expect(latest.channelId).toBe('ch-general');
    expect(latest.messages).toEqual(GENERAL);
  });

  it('drops a buffered page once the channel confirms it is empty', () => {
    const { update } = setup({
      channelId: 'ch-general',
      messages: GENERAL,
      isLoading: false,
    });
    update({ channelId: 'ch-general', messages: [], isLoading: false });
    update({ channelId: 'ch-helpers', messages: HELPERS, isLoading: false });

    // Coming back to General must not repaint the page it had before it
    // emptied out; it falls through to the ordinary cross-channel hold.
    update({ channelId: 'ch-general', messages: [], isLoading: true });
    expect(latest.messages).not.toEqual(GENERAL);
    expect(latest.channelId).toBe('ch-helpers');
    expect(latest.isSwitching).toBe(true);
  });

  it('stops holding once the bound elapses, so a dead socket cannot strand the list', () => {
    const { update } = setup({
      channelId: 'ch-general',
      messages: GENERAL,
      isLoading: false,
    });

    update({ channelId: 'ch-helpers', messages: [], isLoading: true });
    expect(latest.isSwitching).toBe(true);

    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(latest.isSwitching).toBe(false);
    expect(latest.messages).toEqual([]);
  });

  it('re-arms the hold after the channel finally loads', () => {
    const { update } = setup({
      channelId: 'ch-general',
      messages: GENERAL,
      isLoading: false,
    });

    update({ channelId: 'ch-helpers', messages: [], isLoading: true });
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(latest.isSwitching).toBe(false);

    // Socket recovers.
    update({ channelId: 'ch-helpers', messages: HELPERS, isLoading: false });
    update({ channelId: 'ch-general', messages: GENERAL, isLoading: false });

    // A later switch back to Helpers holds again rather than staying
    // disqualified by that one bad moment — and it has its own page buffered
    // now, so it repaints Helpers rather than General.
    update({ channelId: 'ch-helpers', messages: [], isLoading: true });
    expect(latest.messages).toEqual(HELPERS);
    expect(latest.channelId).toBe('ch-helpers');
  });
});
