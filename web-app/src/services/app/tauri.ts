/**
 * Tauri App Service - Desktop implementation
 */

import { invoke } from '@tauri-apps/api/core'
import { AppConfiguration } from '@janhq/core'
import { localStorageKey } from '@/constants/localStorage'
import type { LogEntry } from './types'
import { DefaultAppService } from './default'

export class TauriAppService extends DefaultAppService {
  private static readonly BACKEND_PRESERVE_KEYS = [
    'llama_cpp_backend_type',
  ]

  async factoryReset(): Promise<void> {
    const { EngineManager } = await import('@janhq/core')
    for (const [, engine] of EngineManager.instance().engines) {
      const activeModels = await engine.getLoadedModels()
      if (activeModels) {
        await Promise.all(activeModels.map((model: string) => engine.unload(model)))
      }
    }

    const savedBackend: Record<string, string> = {}
    for (const key of TauriAppService.BACKEND_PRESERVE_KEYS) {
      const val = window.localStorage.getItem(key)
      if (val) savedBackend[key] = val
    }

    window.localStorage.clear()

    for (const [key, val] of Object.entries(savedBackend)) {
      window.localStorage.setItem(key, val)
    }

    window.localStorage.setItem(localStorageKey.factoryResetPending, 'true')
    await invoke('factory_reset')
  }

  async readLogs(): Promise<LogEntry[]> {
    const logData: string = (await invoke('read_logs')) ?? ''
    return logData.split('\n').map(this.parseLogLine)
  }

  async getJanDataFolder(): Promise<string | undefined> {
    try {
      const appConfiguration: AppConfiguration | undefined =
        await window.core?.api?.getAppConfigurations()

      return appConfiguration?.data_folder
    } catch (error) {
      console.error('Failed to get Jan data folder:', error)
      return undefined
    }
  }

  async relocateJanDataFolder(path: string): Promise<void> {
    await window.core?.api?.changeAppDataFolder({ newDataFolder: path })
  }

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
    return await invoke<boolean>('get_server_status')
  }

  async readYaml<T = unknown>(path: string): Promise<T> {
    return await invoke<T>('read_yaml', { path })
  }
}
