// @ts-nocheck
import { app, Menu, shell, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'
import { log } from '@janhq/core/node'
const isMac = process.platform === 'darwin'

const template: (Electron.MenuItemConstructorOptions | Electron.MenuItem)[] = [
  {
    label: app.name,
    submenu: [
      {
        label: `About ${app.name}`,
        click: () =>
          dialog.showMessageBox({
            title: `Jan`,
            message: `Jan Version v${app.getVersion()}\n\nCopyright © 2024 Jan`,
          }),
      },
      {
        label: 'Check for Updates...',
        click: () =>
          // Check for updates and notify user if there are any
          autoUpdater
            .checkForUpdatesAndNotify()
            .then((updateCheckResult) => {
              if (
                !updateCheckResult?.updateInfo ||
                updateCheckResult?.updateInfo.version === app.getVersion()
              ) {
                dialog.showMessageBox({
                  message: `No updates available.`,
                })
                return
              }
            })
            .catch((error) => {
              log('Error checking for updates:' + JSON.stringify(error))
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
          await shell.openExternal('https://jan.ai/guides/')
        },
      },
    ],
  },
]

export const setupMenu = () => {
  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}
