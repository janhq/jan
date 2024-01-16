// @ts-nocheck
import { app, Menu, dialog, shell } from 'electron'
const isMac = process.platform === 'darwin'
const { autoUpdater } = require('electron-updater')
import { compareSemanticVersions } from './versionDiff'

const template: (Electron.MenuItemConstructorOptions | Electron.MenuItem)[] = [
  {
    label: app.name,
    submenu: [
      { role: 'about' },
      {
        label: 'Check for Updates...',
        click: () =>
          autoUpdater.checkForUpdatesAndNotify().then((e) => {
            if (
              !e ||
              compareSemanticVersions(app.getVersion(), e.updateInfo.version) >=
                0
            )
              dialog.showMessageBox({
                message: `There are currently no updates available.`,
              })
          }),
      },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  },
  {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      ...(isMac
        ? [
            { role: 'pasteAndMatchStyle' },
            { role: 'delete' },
            { role: 'selectAll' },
            { type: 'separator' },
            {
              label: 'Speech',
              submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }],
            },
          ]
        : [{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }]),
    ],
  },
  {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  },
  {
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      ...(isMac
        ? [
            { type: 'separator' },
            { role: 'front' },
            { type: 'separator' },
            { role: 'window' },
          ]
        : [{ role: 'close' }]),
    ],
  },
  {
    role: 'help',
    submenu: [
      {
        label: 'Learn More',
        click: async () => {
          await shell.openExternal('https://jan.ai/')
        },
      },
    ],
  },
]

export const setupMenu = () => {
  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}
