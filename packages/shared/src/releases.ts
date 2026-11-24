/** A published Meld release, with its notes tidied for reading in the app. */
export type Release = {
  /** Without the tag's leading v, e.g. 0.2.0. */
  version: string;
  /** The release title, e.g. "Meld 0.2.0". */
  name: string;
  publishedAt: string;
  /** Markdown. */
  notes: string;
  /** The release on GitHub. */
  url: string;
};

export type ReleaseList = {
  /** Newest first. */
  releases: Release[];
};

/** Where the desktop app is with updates, as the page sees it through the desktop bridge. */
export type UpdateState =
  /** Not checked yet. */
  | { status: 'idle' }
  | { status: 'checking' }
  /** Checked: this is the newest version. */
  | { status: 'current' }
  | { status: 'available'; version: string }
  | { status: 'downloading'; version: string; percent: number }
  /** Downloaded: restarting installs it (so does quitting). */
  | { status: 'ready'; version: string }
  /** `version` is set when the failure was while downloading it. */
  | { status: 'error'; message: string; version?: string };

/** What the Mac app's window exposes to the page as `window.meldDesktop`. Absent in a browser. */
export type DesktopBridge = {
  version: string;
  getUpdateState: () => Promise<UpdateState>;
  /** Calls back with every change; returns the unsubscribe. */
  onUpdateState: (listener: (state: UpdateState) => void) => () => void;
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  /** Quits, installs the downloaded update and opens Meld again. */
  installUpdate: () => Promise<void>;
};
