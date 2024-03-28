import { app, dialog } from 'electron'
import { windowManager } from './../managers/window'
import {
  ProgressInfo,
  UpdateDownloadedEvent,
  UpdateInfo,
  autoUpdater,
} from 'electron-updater'
import { AppEvent } from '@janhq/core/node'
import { trayManager } from '../managers/tray'

export let waitingToInstallVersion: string | undefined = undefined

export function handleAppUpdates() {
  /* Should not check for update during development */
  if (!app.isPackaged) {
    return
  }
  /* New Update Available */
  autoUpdater.on('update-available', async (_info: UpdateInfo) => {
    const action = await dialog.showMessageBox({
      title: 'Update Available',
      message: 'Would you like to download and install it now?',
      buttons: ['Download', 'Later'],
    })

    if (action.response === 0) await autoUpdater.downloadUpdate()
  })

  /* App Update Completion Message */
  autoUpdater.on('update-downloaded', async (_info: UpdateDownloadedEvent) => {
    windowManager.mainWindow?.webContents.send(
      AppEvent.onAppUpdateDownloadSuccess,
      {}
    )
    const action = await dialog.showMessageBox({
      message: `Update downloaded. Please restart the application to apply the updates.`,
      buttons: ['Restart', 'Later'],
    })
    if (action.response === 0) {
      trayManager.destroyCurrentTray()
      windowManager.closeQuickAskWindow()
      waitingToInstallVersion = _info?.version
      autoUpdater.quitAndInstall()
    }
  })

  /* App Update Error */
  autoUpdater.on('error', (info: Error) => {
    windowManager.mainWindow?.webContents.send(
      AppEvent.onAppUpdateDownloadError,
      { failedToInstallVersion: waitingToInstallVersion, info }
    )
  })

  /* App Update Progress */
  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    console.debug('app update progress: ', progress.percent)
    windowManager.mainWindow?.webContents.send(
      AppEvent.onAppUpdateDownloadUpdate,
      {
        ...progress,
      }
    )
  })

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  if (process.env.CI !== 'e2e') {
    autoUpdater.checkForUpdates()
  }
}
