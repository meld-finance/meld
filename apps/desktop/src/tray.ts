import path from 'node:path';
import { Menu, Tray, app, nativeImage, shell, type MenuItemConstructorOptions } from 'electron';
import { logFile } from './log';
import { paths } from './paths';

const isMac = process.platform === 'darwin';

/** The icon: a template macOS tints for the menu bar; the app icon in the Windows notification area. */
function trayIcon() {
  const build = path.join(app.getAppPath(), 'build');
  if (!isMac) return nativeImage.createFromPath(path.join(build, 'icon.png')).resize({ width: 32, height: 32, quality: 'best' });
  const icon = nativeImage.createFromPath(path.join(build, 'trayTemplate.png'));
  icon.setTemplateImage(true);
  return icon;
}

type TrayActions = {
  open: () => void;
  openSettings: () => void;
  quit: () => void;
  /** "Update to Meld 0.3.0…" and the like, when there's an update; read each time the menu is rebuilt. */
  updateItem: () => MenuItemConstructorOptions | null;
};

/**
 * The menu bar (or notification area) item: Meld keeps running there with the window closed, so a phone can still reach it.
 * Returns a function that rebuilds the menu (call it when the update state changes).
 */
export function createTray(actions: TrayActions) {
  const tray = new Tray(trayIcon());
  tray.setToolTip('Meld');
  // On Windows a click on the icon opens the app and a right-click shows the menu.
  if (!isMac) tray.on('click', actions.open);

  const update = () => {
    const openAtLogin = app.getLoginItemSettings().openAtLogin;
    const updateItem = actions.updateItem();
    tray.setContextMenu(
      Menu.buildFromTemplate([
        ...(updateItem ? [updateItem, { type: 'separator' as const }] : []),
        { label: 'Open Meld', click: actions.open },
        { label: 'Phone Access…', click: actions.openSettings },
        { type: 'separator' },
        {
          label: 'Open at Login',
          type: 'checkbox',
          checked: openAtLogin,
          click: () => {
            app.setLoginItemSettings({ openAtLogin: !openAtLogin });
            update();
          },
        },
        { label: 'Show Data Folder', click: () => void shell.openPath(paths.data()) },
        { label: 'Show Log', click: () => shell.showItemInFolder(logFile()) },
        { type: 'separator' },
        { label: 'Quit Meld', click: actions.quit },
      ]),
    );
  };
  update();
  return update;
}
