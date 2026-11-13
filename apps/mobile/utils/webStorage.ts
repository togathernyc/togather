/**
 * Web logout wipes localStorage (where AsyncStorage lives on web) so the next
 * person on a shared browser starts clean. A few keys are per-user device
 * preferences that must survive that wipe; they are listed here.
 */

/** Key prefixes kept through the web logout wipe. Each key already embeds the user id. */
export const PRESERVED_ACROSS_LOGOUT_PREFIXES = ['kingdomcity-migration-notice-dismissed:'];

type ClearableStorage = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'clear'>;

/** Clears `storage`, then restores every key that starts with one of `preservedPrefixes`. */
export function clearStorageExcept(storage: ClearableStorage, preservedPrefixes: string[]): void {
  const kept: [string, string][] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && preservedPrefixes.some((prefix) => key.startsWith(prefix))) {
      const value = storage.getItem(key);
      if (value !== null) kept.push([key, value]);
    }
  }
  storage.clear();
  for (const [key, value] of kept) storage.setItem(key, value);
}
