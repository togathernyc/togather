/**
 * The birthday gift badge, and how it shares an avatar with the slashed-bell
 * badge. The corner split is the point: someone can be muted on their birthday,
 * and both badges have to stay readable.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { BirthdayBadge, BIRTHDAY_COLOR } from '../BirthdayBadge';
import { Avatar } from '../Avatar';
import { WaAvatar } from '../../wa/WaAvatar';

const flatten = (style: any): Record<string, any> =>
  Array.isArray(style)
    ? Object.assign({}, ...style.map(flatten))
    : (style ?? {});

describe('BirthdayBadge', () => {
  it('sits in the top-right corner, opposite the slashed bell', () => {
    const { getByTestId } = render(<BirthdayBadge avatarSize={56} />);
    const style = flatten(getByTestId('birthday-badge').props.style);

    expect(style.position).toBe('absolute');
    expect(style.top).toBe(-2);
    expect(style.right).toBe(-2);
    expect(style.bottom).toBeUndefined();
  });

  it('uses the birthday accent, not a themed colour', () => {
    const { getByTestId } = render(<BirthdayBadge avatarSize={56} />);
    expect(flatten(getByTestId('birthday-badge').props.style).backgroundColor).toBe(
      BIRTHDAY_COLOR,
    );
  });

  it('scales with the avatar and stays a circle', () => {
    const { getByTestId } = render(<BirthdayBadge avatarSize={56} />);
    const style = flatten(getByTestId('birthday-badge').props.style);

    // 56 * 0.42 -> 24, within the 11..26 clamp.
    expect(style.width).toBe(24);
    expect(style.height).toBe(24);
    expect(style.borderRadius).toBe(12);
  });

  it('clamps so it stays legible on a tiny avatar and modest on a huge one', () => {
    const tiny = render(<BirthdayBadge avatarSize={20} />);
    expect(flatten(tiny.getByTestId('birthday-badge').props.style).width).toBe(11);

    const huge = render(<BirthdayBadge avatarSize={200} />);
    expect(flatten(huge.getByTestId('birthday-badge').props.style).width).toBe(26);
  });

  it('takes its contrast ring from the surface it is passed', () => {
    const { getByTestId } = render(
      <BirthdayBadge avatarSize={56} ringColor="#123456" />,
    );
    expect(flatten(getByTestId('birthday-badge').props.style).borderColor).toBe(
      '#123456',
    );
  });
});

describe.each([
  ['Avatar', (props: any) => <Avatar name="Tadala Jumbe" size={56} {...props} />],
  [
    'WaAvatar',
    (props: any) => <WaAvatar label="Tadala Jumbe" size={56} {...props} />,
  ],
])('%s birthday wiring', (_name, renderAvatar) => {
  it('shows no badge on an ordinary day', () => {
    const { queryByTestId } = render(renderAvatar({}));
    expect(queryByTestId('birthday-badge')).toBeNull();
  });

  it('shows the badge on their birthday', () => {
    const { queryByTestId } = render(renderAvatar({ isBirthdayToday: true }));
    expect(queryByTestId('birthday-badge')).toBeTruthy();
  });

  it('shows the badge for a muted user too — the corners do not collide', () => {
    const { queryByTestId } = render(
      renderAvatar({ isBirthdayToday: true, notificationsDisabled: true }),
    );
    expect(queryByTestId('birthday-badge')).toBeTruthy();
  });
});
