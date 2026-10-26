// Web: localStorage, which can be unavailable (private mode, blocked storage),
// so every access is guarded and failure just means "logged out".
const KEY = 'meld.session';

export const tokenStore = {
  async get(): Promise<string | null> {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  async set(token: string): Promise<void> {
    try {
      localStorage.setItem(KEY, token);
    } catch {}
  },
  async clear(): Promise<void> {
    try {
      localStorage.removeItem(KEY);
    } catch {}
  },
};
