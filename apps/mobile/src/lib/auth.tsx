import type { LoginResponse } from '@meld/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { api, setAuthToken, setUnauthorizedHandler } from './api';
import { tokenStore } from './token-store';

type AuthState = {
  /** False until the stored token has been read. */
  ready: boolean;
  isLoggedIn: boolean;
  login: (passphrase: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);

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
    () => ({ ready, isLoggedIn: token !== null, login, logout }),
    [ready, token, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
