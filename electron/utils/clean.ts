import { windowManager } from './../managers/window'
import { app } from 'electron'
import { cleanCortexProcesses, stopCortexApiServer } from './cortex'


/**
 * Clean up windows then quit
 */
export async function cleanUpAndQuit() {
  windowManager.cleanUp()
  await stopCortexApiServer()
  await cleanCortexProcesses()
  app.quit()
}