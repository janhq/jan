/**
 * Tauri App Service - Desktop implementation
 */

import { invoke } from '@tauri-apps/api/core'
import { AppConfiguration } from '@janhq/core'
import type { FactoryResetOptions, LogEntry } from './types'
import { DefaultAppService } from './default'
import { localStorageKey } from '@/constants/localStorage'

export class TauriAppService extends DefaultAppService {
  /**
   * Factory reset with optional data preservation.
   *
   * User settings are persisted to `settings.json` via @tauri-apps/plugin-store
   * (see #7821). The Rust `factory_reset` command conditionally deletes
   * directories, config files, and `settings.json` based on the keep flags.
   * No frontend snapshot/restore is needed — the file store is preserved or
   * wiped on disk by the Rust side.
   *
   * Persisted UI state (selected model, provider list, threads) lives in the
   * webview localStorage, not the data folder — so it must be pruned here to
   * match what the Rust side deletes. Otherwise stale providers keep
   * `hasValidProviders` true (skipping setup) with a now-deleted model selected.
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

    this.pruneLocalStorage(keepAppData, keepModelsAndConfigs)

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

  /**
   * Remove webview-persisted UI state for whatever the reset is wiping, so the
   * app rehydrates from the (now empty) disk instead of stale localStorage.
   */
  private pruneLocalStorage(
    keepAppData: boolean,
    keepModelsAndConfigs: boolean
  ): void {
    if (typeof localStorage === 'undefined') return

    const k = localStorageKey
    const remove = (keys: string[]) => keys.forEach((key) => localStorage.removeItem(key))

    if (!keepModelsAndConfigs) {
      remove([
        k.modelProvider,
        k.modelSources,
        k.lastUsedModel,
        k.lastUsedAssistant,
        k.defaultAssistantId,
        k.favoriteModels,
        k.latestJanModel,
        k.defaultEmbeddingModel,
        k.modelSupportCache,
        k.janModelPromptDismissed,
        k.pausedDownloads,
      ])
    }

    if (!keepAppData) {
      remove([k.threads, k.messages, k.threadManagement, k.recentSearches])
    }

    // A full wipe should land back on first-run onboarding.
    if (!keepAppData && !keepModelsAndConfigs) {
      remove([k.setupCompleted])
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
