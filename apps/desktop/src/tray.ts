import path from 'node:path';
import { Menu, Tray, app, nativeImage, shell } from 'electron';
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

/** The menu bar (or notification area) item: Meld keeps running there with the window closed, so a phone can still reach it. */
export function createTray(actions: { open: () => void; openSettings: () => void; quit: () => void }) {
  const tray = new Tray(trayIcon());
  tray.setToolTip('Meld');
  // On Windows a click on the icon opens the app and a right-click shows the menu.
  if (!isMac) tray.on('click', actions.open);

  const update = () => {
    const openAtLogin = app.getLoginItemSettings().openAtLogin;
    tray.setContextMenu(
      Menu.buildFromTemplate([
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
  return tray;
}
