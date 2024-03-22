import { ModuleManager } from '@janhq/core/node'
import { windowManager } from './../managers/window'
import { dispose } from './disposable'
import { app } from 'electron'

export function cleanUpAndQuit() {
  if (!ModuleManager.instance.cleaningResource) {
    ModuleManager.instance.cleaningResource = true
    windowManager.cleanUp()
    dispose(ModuleManager.instance.requiredModules)
    ModuleManager.instance.clearImportedModules()
    app.quit()
  }
}
