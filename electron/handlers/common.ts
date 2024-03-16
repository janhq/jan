import { Handler, RequestHandler } from '@janhq/core/node'
import { ipcMain } from 'electron'
import { windowManager } from '../managers/window'

export function injectHandler() {
  const ipcWrapper: Handler = (
    route: string,
    listener: (...args: any[]) => any
  ) =>
    ipcMain.handle(route, async (_event, ...args: any[]) => {
      return listener(...args)
    })

  const handler = new RequestHandler(
    ipcWrapper,
    (channel: string, args: any) =>
      windowManager.mainWindow?.webContents.send(channel, args)
  )
  handler.handle()
}
