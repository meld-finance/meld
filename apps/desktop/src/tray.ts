import path from 'node:path';
import { Menu, Tray, app, nativeImage, shell } from 'electron';
import { logFile } from './log';
import { paths } from './paths';

const ICON = 'trayTemplate.png';

/** The menu bar item: Meld keeps running there with the window closed, so a phone can still reach it. */
export function createTray(actions: { open: () => void; openSettings: () => void; quit: () => void }) {
  const icon = nativeImage.createFromPath(path.join(app.getAppPath(), 'build', ICON));
  icon.setTemplateImage(true);
  const tray = new Tray(icon);
  tray.setToolTip('Meld');

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
