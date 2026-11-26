// The bridge between Meld's page and the app, as window.meldDesktop: the version, updates, and the token that signs the window in.
// Bundled to dist/preload.cjs (a sandboxed preload can't be an ES module).
import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge, UpdateState } from '@meld/shared';

const bridge: DesktopBridge = {
  version: ipcRenderer.sendSync('meld:version') as string,
  sessionToken: ipcRenderer.sendSync('meld:session') as string,
  getUpdateState: () => ipcRenderer.invoke('meld:update-state') as Promise<UpdateState>,
  onUpdateState: (listener) => {
    const handler = (_event: unknown, state: UpdateState) => listener(state);
    ipcRenderer.on('meld:update-state', handler);
    return () => void ipcRenderer.removeListener('meld:update-state', handler);
  },
  checkForUpdates: () => ipcRenderer.invoke('meld:update-check') as Promise<void>,
  downloadUpdate: () => ipcRenderer.invoke('meld:update-download') as Promise<void>,
  installUpdate: () => ipcRenderer.invoke('meld:update-install') as Promise<void>,
};

contextBridge.exposeInMainWorld('meldDesktop', bridge);
