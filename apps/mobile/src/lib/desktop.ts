import type { DesktopBridge, UpdateState } from '@meld/shared';
import { useEffect, useState } from 'react';

/** The Mac app's bridge (its window's preload sets it); null in a browser, on a phone and in native builds. */
export function desktop(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as { meldDesktop?: DesktopBridge }).meldDesktop ?? null;
}

/** The desktop app's update state, kept current; null outside the Mac app. */
export function useUpdateState(): UpdateState | null {
  const bridge = desktop();
  const [state, setState] = useState<UpdateState | null>(bridge ? { status: 'idle' } : null);
  useEffect(() => {
    if (!bridge) return;
    let live = true;
    const off = bridge.onUpdateState(setState);
    void bridge.getUpdateState().then((s) => live && setState(s));
    return () => {
      live = false;
      off();
    };
  }, [bridge]);
  return state;
}

/** The version an update offers, when there's one to act on (found, downloading, ready, or a failed download). */
export function pendingVersion(state: UpdateState | null): string | null {
  if (!state) return null;
  if (state.status === 'available' || state.status === 'downloading' || state.status === 'ready') return state.version;
  if (state.status === 'error') return state.version ?? null;
  return null;
}

/** Compares dotted versions numerically: 0.10.0 is newer than 0.9.2. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}
