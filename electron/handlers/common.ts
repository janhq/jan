import { Handler, RequestHandler } from '@janhq/core/node'
import { ipcMain } from 'electron'
import { WindowManager } from '../managers/window'

export function injectHandler() {
  const ipcWrapper: Handler = (
    route: string,
    listener: (...args: any[]) => any
  ) => {
    return ipcMain.handle(route, async (event, ...args: any[]) => {
      return listener(...args)
    })
  }

  const handler = new RequestHandler(
    ipcWrapper,
    (channel: string, args: any) => {
      return WindowManager.instance.currentWindow?.webContents.send(
        channel,
        args
      )
    }
  )
  handler.handle()
}
