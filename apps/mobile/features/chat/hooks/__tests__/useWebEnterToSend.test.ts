import { shouldSendOnEnter } from '../useWebEnterToSend';

function keyEvent(overrides: Partial<Parameters<typeof shouldSendOnEnter>[0]> = {}) {
  return {
    key: 'Enter',
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    isComposing: false,
    ...overrides,
  };
}

describe('shouldSendOnEnter', () => {
  test('sends on plain Enter', () => {
    expect(shouldSendOnEnter(keyEvent())).toBe(true);
  });

  test('does not send on Shift+Enter (newline)', () => {
    expect(shouldSendOnEnter(keyEvent({ shiftKey: true }))).toBe(false);
  });

  test('does not send on Ctrl+Enter', () => {
    expect(shouldSendOnEnter(keyEvent({ ctrlKey: true }))).toBe(false);
  });

  test('does not send on Meta+Enter (Cmd+Enter on macOS)', () => {
    expect(shouldSendOnEnter(keyEvent({ metaKey: true }))).toBe(false);
  });

  test('does not send on Alt+Enter', () => {
    expect(shouldSendOnEnter(keyEvent({ altKey: true }))).toBe(false);
  });

  test('does not send while IME composition is in progress', () => {
    expect(shouldSendOnEnter(keyEvent({ isComposing: true }))).toBe(false);
  });

  test('does not send for keys other than Enter', () => {
    expect(shouldSendOnEnter(keyEvent({ key: 'a' }))).toBe(false);
    expect(shouldSendOnEnter(keyEvent({ key: 'Tab' }))).toBe(false);
    expect(shouldSendOnEnter(keyEvent({ key: 'Escape' }))).toBe(false);
  });
});
