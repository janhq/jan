import { join } from 'path'
import { Tray, app, Menu } from 'electron'
import { windowManager } from '../managers/window'
import { getAppConfigurations } from '@janhq/core/node'

class TrayManager {
  currentTray: Tray | undefined

  createSystemTray = () => {
    // Feature Toggle for Quick Ask
    if (!getAppConfigurations().quick_ask) return

    if (this.currentTray) {
      return
    }
    const iconPath = join(app.getAppPath(), 'icons', 'icon-tray.png')
    const tray = new Tray(iconPath)
    tray.setToolTip(app.getName())

    tray.on('click', () => {
      windowManager.showQuickAskWindow()
    })

    // Add context menu for windows only
    if (process.platform === 'win32') {
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
    this.currentTray = tray
  }

  destroyCurrentTray() {
    this.currentTray?.destroy()
    this.currentTray = undefined
  }
}

export const trayManager = new TrayManager()
