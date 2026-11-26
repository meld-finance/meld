import type { LoginResponse } from '@meld/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { api, setAuthToken, setUnauthorizedHandler } from './api';
import { desktop } from './desktop';
import { useSetupStatus } from './setup';
import { tokenStore } from './token-store';

type AuthState = {
  /** False until the stored token has been read. */
  ready: boolean;
  /** Logged in, or the passphrase is turned off. */
  isLoggedIn: boolean;
  /** Unlocking takes a passphrase, so there's something to lock. */
  canLock: boolean;
  /** This is the desktop app's own window, which signs itself in. */
  isDesktopWindow: boolean;
  login: (passphrase: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

/** The desktop app's window token, read once: it doesn't change while the app runs. */
const desktopToken = desktop()?.sessionToken || null;
// Set before the first request, so even first-run setup goes out signed in.
if (desktopToken) setAuthToken(desktopToken);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!!desktopToken);
  const [token, setToken] = useState<string | null>(desktopToken);
  // An older API doesn't say, and always asks for one. The desktop window never locks.
  const status = useSetupStatus();
  const canLock = !desktopToken && (status.data?.passphrase ?? true);

  const apply = useCallback((next: string | null) => {
    setAuthToken(next);
    setToken(next);
  }, []);

  const logout = useCallback(async () => {
    if (desktopToken) return;
    apply(null);
    await tokenStore.clear();
  }, [apply]);

  useEffect(() => {
    if (desktopToken) return;
    tokenStore.get().then((stored) => {
      apply(stored);
      setReady(true);
    });
    setUnauthorizedHandler(() => void logout());
    return () => setUnauthorizedHandler(null);
  }, [apply, logout]);

  const login = useCallback(
    async (passphrase: string) => {
      // The desktop window stays signed in with its own token.
      if (desktopToken) return;
      const res = await api<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ passphrase }),
      });
      await tokenStore.set(res.token);
      apply(res.token);
    },
    [apply],
  );

  const value = useMemo(
    () => ({ ready, isLoggedIn: !canLock || token !== null, canLock, isDesktopWindow: !!desktopToken, login, logout }),
    [ready, token, canLock, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
