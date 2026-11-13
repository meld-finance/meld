import type { LoginResponse } from '@meld/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { api, setAuthToken, setUnauthorizedHandler } from './api';
import { useSetupStatus } from './setup';
import { tokenStore } from './token-store';

type AuthState = {
  /** False until the stored token has been read. */
  ready: boolean;
  /** Logged in, or the passphrase is turned off. */
  isLoggedIn: boolean;
  /** Unlocking takes a passphrase, so there's something to lock. */
  canLock: boolean;
  login: (passphrase: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  // An older API doesn't say, and always asks for one.
  const canLock = useSetupStatus().data?.passphrase ?? true;

  const apply = useCallback((next: string | null) => {
    setAuthToken(next);
    setToken(next);
  }, []);

  const logout = useCallback(async () => {
    apply(null);
    await tokenStore.clear();
  }, [apply]);

  useEffect(() => {
    tokenStore.get().then((stored) => {
      apply(stored);
      setReady(true);
    });
    setUnauthorizedHandler(() => void logout());
    return () => setUnauthorizedHandler(null);
  }, [apply, logout]);

  const login = useCallback(
    async (passphrase: string) => {
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
    () => ({ ready, isLoggedIn: !canLock || token !== null, canLock, login, logout }),
    [ready, token, canLock, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
