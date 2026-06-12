/** Stub of @togather/shared/utils for the demo bundle (in-memory storage). */
const mem = new Map<string, string>();

export const storage = {
  getItem: async (key: string) => mem.get(key) ?? null,
  setItem: async (key: string, value: string) => {
    mem.set(key, value);
  },
  removeItem: async (key: string) => {
    mem.delete(key);
  },
  getJSON: async <T,>(key: string): Promise<T | null> => {
    const v = mem.get(key);
    return v ? (JSON.parse(v) as T) : null;
  },
  setJSON: async (key: string, value: unknown) => {
    mem.set(key, JSON.stringify(value));
  },
};

export default { storage };
