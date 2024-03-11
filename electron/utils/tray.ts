import { join } from 'path'
import { Tray, app, Menu } from 'electron'
import { windowManager } from '../managers/window'

export const createSystemTray = () => {
  const iconPath = join(app.getAppPath(), 'icons', 'icon-tray.png')
  const tray = new Tray(iconPath)
  tray.setToolTip(app.getName())

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Jan',
      type: 'normal',
      click: () => windowManager.showMainWindow(),
    },
    {
      label: 'Open Quick Ask',
      type: 'normal',
      click: () => windowManager.showQuickAskWindow(),
    },
    { label: 'Quit', type: 'normal', click: () => app.quit() },
  ])
  tray.setContextMenu(contextMenu)
}
