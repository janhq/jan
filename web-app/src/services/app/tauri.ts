/**
 * Tauri App Service - Desktop implementation
 * 
 * MOVED FROM: src/services/app.ts
 * NO IMPLEMENTATION CHANGES - EXACT SAME LOGIC MOVED HERE
 */

import { invoke } from '@tauri-apps/api/core'
import { AppConfiguration } from '@janhq/core'
import type { LogEntry } from './types'
import { DefaultAppService } from './default'

export class TauriAppService extends DefaultAppService {
  /**
   * MOVED FROM: factoryReset function in src/services/app.ts
   */
  async factoryReset(): Promise<void> {
    try {
      // Kill background processes and remove data folder
      // Note: We can't import stopAllModels directly to avoid circular dependency
      // Instead we'll use the engine manager directly
      const { EngineManager } = await import('@janhq/core')
      for (const [, engine] of EngineManager.instance().engines) {
        const activeModels = await engine.getLoadedModels()
        if (activeModels) {
          await Promise.all(activeModels.map((model: string) => engine.unload(model)))
        }
      }
      window.localStorage.clear()
      await invoke('factory_reset')
    } catch (error) {
      console.error('Error in Tauri factory reset, falling back to default:', error)
      return super.factoryReset()
    }
  }

  /**
   * MOVED FROM: readLogs function in src/services/app.ts
   */
  async readLogs(): Promise<LogEntry[]> {
    try {
      const logData: string = (await invoke('read_logs')) ?? ''
      return logData.split('\n').map(this.parseLogLine)
    } catch (error) {
      console.error('Error reading logs in Tauri, falling back to default:', error)
      return super.readLogs()
    }
  }

  /**
   * MOVED FROM: getJanDataFolder function in src/services/app.ts
   */
  async getJanDataFolder(): Promise<string | undefined> {
    try {
      const appConfiguration: AppConfiguration | undefined =
        await window.core?.api?.getAppConfigurations()

      return appConfiguration?.data_folder
    } catch (error) {
      console.error('Failed to get Jan data folder in Tauri, falling back to default:', error)
      return super.getJanDataFolder()
    }
  }

  /**
   * MOVED FROM: relocateJanDataFolder function in src/services/app.ts
   */
  async relocateJanDataFolder(path: string): Promise<void> {
    try {
      await window.core?.api?.changeAppDataFolder({ newDataFolder: path })
    } catch (error) {
      console.error('Error relocating Jan data folder in Tauri, falling back to default:', error)
      return super.relocateJanDataFolder(path)
    }
  }

  /**
   * MOVED FROM: parseLogLine function in src/services/app.ts
   * Helper function for parsing log entries - PUBLIC METHOD
   */
  parseLogLine(line: string): LogEntry {
    const regex = /^\[(.*?)\]\[(.*?)\]\[(.*?)\]\[(.*?)\]\s(.*)$/
    const match = line.match(regex)

    if (!match)
      return {
        timestamp: Date.now(),
        level: 'info' as 'info' | 'warn' | 'error' | 'debug',
        target: 'info',
        message: line ?? '',
      } as LogEntry

    const [, date, time, target, levelRaw, message] = match

    const level = levelRaw.toLowerCase() as 'info' | 'warn' | 'error' | 'debug'

    return {
      timestamp: `${date} ${time}`,
      level,
      target,
      message,
    }
  }

  async getServerStatus(): Promise<boolean> {
    try {
      return await invoke<boolean>('get_server_status')
    } catch (error) {
      console.error('Error getting server status in Tauri, falling back to default:', error)
      return super.getServerStatus()
    }
  }

  async readYaml<T = unknown>(path: string): Promise<T> {
    try {
      return await invoke<T>('read_yaml', { path })
    } catch (error) {
      console.error('Error reading YAML in Tauri, falling back to default:', error)
      return super.readYaml<T>(path)
    }
  }
}