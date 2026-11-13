import { clearStorageExcept } from '../webStorage';

function fakeStorage(entries: Record<string, string>) {
  const data = new Map(Object.entries(entries));
  return {
    get length() {
      return data.size;
    },
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    data,
  };
}

describe('clearStorageExcept', () => {
  it('clears everything except keys with a preserved prefix', () => {
    const storage = fakeStorage({
      token: 'abc',
      'cache:inbox': '[]',
      'keep:user-1:community-1': '1',
    });

    clearStorageExcept(storage, ['keep:']);

    expect(Object.fromEntries(storage.data)).toEqual({ 'keep:user-1:community-1': '1' });
  });

  it('clears everything when nothing is preserved', () => {
    const storage = fakeStorage({ token: 'abc' });
    clearStorageExcept(storage, []);
    expect(storage.length).toBe(0);
  });
});
