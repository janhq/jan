/**
 * Tauri App Service - Desktop implementation
 */

import { invoke } from '@tauri-apps/api/core'
import { AppConfiguration } from '@janhq/core'
import type { FactoryResetOptions, LogEntry } from './types'
import { DefaultAppService } from './default'
import { pruneLocalStorageByFlags } from './reset-localstorage'

export class TauriAppService extends DefaultAppService {
  /**
   * Factory reset with optional data preservation.
   *
   * User settings are persisted to `<jan_data>/settings.json` by the Rust
   * settings store (`core::app::settings_store`), and secrets to the OS keyring
   * (encrypted-file fallback `provider_secrets.enc`). The Rust `factory_reset`
   * command conditionally deletes directories, config files, `settings.json`,
   * and `provider_secrets.enc` based on the keep flags — no frontend
   * snapshot/restore is needed.
   *
   * localStorage still holds a frozen pre-migration snapshot (kept so a
   * downgraded build can read it). The reliable clear happens on next startup
   * via a Rust sentinel (see `main.tsx`) — renderer-side removal here is a
   * best-effort supplement that races the restart flush.
   */
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
    const clearWebData = options?.clearWebData ?? false

    pruneLocalStorageByFlags({ keepAppData, keepModelsAndConfigs })

    if (!keepAppData && !keepModelsAndConfigs && !clearWebData) {
      await invoke('factory_reset')
    } else {
      await invoke('factory_reset', {
        keepAppData,
        keepModelsAndConfigs,
        clearWebData,
      })
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
