import { windowManager } from './../managers/window'
import { app } from 'electron'

export function cleanUpAndQuit() {
  windowManager.cleanUp()
  app.quit()
}
