/**
 * Tauri App Service - Desktop implementation
 */

import { invoke } from '@tauri-apps/api/core'
import { AppConfiguration } from '@janhq/core'
import type { FactoryResetOptions, LogEntry } from './types'
import { DefaultAppService } from './default'

const APP_DATA_KEYS = [
  'threads',
  'messages',
  'thread-management',
]

const MODELS_AND_CONFIG_KEYS = [
  'model-provider',
  'model-sources',
  'setting-local-api-server',
  'setting-proxy-config',
  'setting-hardware',
  'setting-vulkan',
  'favorite-models',
  'last-used-model',
  'last-used-assistant',
  'default-assistant-id',
  'tool-approval',
  'tool-availability',
  'mcp-global-permissions',
  'agent-mode',
  'claude-code-helper-models',
]

export class TauriAppService extends DefaultAppService {
  async factoryReset(options?: FactoryResetOptions): Promise<void> {
    const { EngineManager } = await import('@janhq/core')
    for (const [, engine] of EngineManager.instance().engines) {
      const activeModels = await engine.getLoadedModels()
      if (activeModels) {
        await Promise.all(activeModels.map((model: string) => engine.unload(model)))
      }
    }

    const keepAppData = options?.keepAppData ?? false
    const keepModelsAndConfigs = options?.keepModelsAndConfigs ?? false

    const snapshot = this.snapshotLocalStorage(options)
    window.localStorage.clear()
    this.restoreLocalStorage(snapshot)

    if (!keepAppData && !keepModelsAndConfigs) {
      await invoke('factory_reset')
    } else {
      await invoke('factory_reset', { keepAppData, keepModelsAndConfigs })
    }
  }

  private snapshotLocalStorage(
    options?: FactoryResetOptions
  ): [string, string][] {
    const keepAppData = options?.keepAppData ?? false
    const keepModelsAndConfigs = options?.keepModelsAndConfigs ?? false

    if (!keepAppData && !keepModelsAndConfigs) {
      return []
    }

    const keysToPreserve = new Set<string>()
    if (keepAppData) {
      APP_DATA_KEYS.forEach((k) => keysToPreserve.add(k))
    }
    if (keepModelsAndConfigs) {
      MODELS_AND_CONFIG_KEYS.forEach((k) => keysToPreserve.add(k))
    }

    const snapshot: [string, string][] = []
    for (const key of keysToPreserve) {
      const value = window.localStorage.getItem(key)
      if (value !== null) {
        snapshot.push([key, value])
      }
    }
    return snapshot
  }

  private restoreLocalStorage(snapshot: [string, string][]): void {
    for (const [key, value] of snapshot) {
      window.localStorage.setItem(key, value)
    }
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
