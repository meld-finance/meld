// Web: localStorage, which can be unavailable (private mode, blocked storage),
// so every access is guarded and failure just means the default is used.
export const prefs = {
  async get(key: string): Promise<string | null> {
    try {
      return localStorage.getItem(`meld.${key}`);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    try {
      localStorage.setItem(`meld.${key}`, value);
    } catch {}
  },
};
