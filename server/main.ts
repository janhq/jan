import { join } from 'path'
import { setupMenu } from './utils/menu'
import { handleFsIPCs } from './handlers/fs'
import app from 'express'

/**
 * Managers
 **/
import { ModuleManager } from './managers/module'
import { PluginManager } from './managers/plugin'

/**
 * IPC Handlers
 **/
import { handleDownloaderIPCs } from './handlers/download'
import { handlePluginIPCs } from './handlers/plugin'

app().listen(6969, ()=>{
  PluginManager.instance.migratePlugins()
  PluginManager.instance.setupPlugins()
  setupMenu()
  handleIPCs()
})

/**
 * Handles various IPC messages from the renderer process.
 */
function handleIPCs() {
  handleFsIPCs()
  handleDownloaderIPCs()
  handlePluginIPCs()
}
