import { useProductAnalytic } from '@/hooks/useAnalytic'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useProxyConfig } from '@/hooks/useProxyConfig'
import { ExtensionManager } from '@/lib/extension'
import { configurePullOptions } from '@/services/models'
import {
  EngineManagementExtension,
  Engines,
  ExtensionTypeEnum,
} from '@janhq/core'
import { invoke } from '@tauri-apps/api/core'

/**
 * Migrates legacy browser data to new browser session.
 */
export const migrateData = async () => {
  if (!localStorage.getItem('migration_completed')) {
    let engines: Engines | undefined
    // Wait for the extension manager to be ready
    let attempts = 0
    await new Promise((resolve) => {
      const checkExtensionManager = async () => {
        engines = await ExtensionManager.getInstance()
          .get<EngineManagementExtension>(ExtensionTypeEnum.Engine)
          ?.getEngines()
        if (engines && attempts < 10) {
          resolve(true)
        } else if (attempts >= 10) {
          resolve(false)
        } else {
          attempts += 1
          setTimeout(checkExtensionManager, 1000)
        }
      }
      checkExtensionManager()
    })
    try {
      // Migrate local storage data
      const oldData = await invoke('get_legacy_browser_data')
      for (const [key, value] of Object.entries(
        oldData as unknown as Record<string, string>
      )) {
        if (value !== null && value !== undefined) {
          if (Object.keys(useLocalApiServer.getState()).includes(key)) {
            useLocalApiServer.setState({
              ...useLocalApiServer.getState(),
              [key]: value.replace(/"/g, ''),
            })
          } else if (Object.keys(useProxyConfig.getState()).includes(key)) {
            useProxyConfig.setState({
              ...useProxyConfig.getState(),
              [key]: value.replace(/"/g, ''),
            })
          } else if (Object.keys(useProductAnalytic.getState()).includes(key)) {
            useProductAnalytic.setState({
              ...useProductAnalytic.getState(),
              [key]: value.replace(/"/g, ''),
            })
          }
        }
      }
      // Migrate provider configurations

      if (engines) {
        for (const [key, value] of Object.entries(engines)) {
          const providerName = key.replace('google_gemini', 'gemini')
          const engine = value[0] as
            | {
                api_key?: string
                url?: string
                engine?: string
              }
            | undefined
          if (engine && 'api_key' in engine) {
            const provider = useModelProvider
              .getState()
              .getProviderByName(providerName)
            const settings = provider?.settings.map((e) => {
              if (e.key === 'api-key')
                e.controller_props.value = (engine.api_key as string) ?? ''
              return e
            })
            if (provider) {
              useModelProvider.getState().updateProvider(providerName, {
                ...provider,
                settings: settings ?? [],
              })
            }
          }
        }
      }
      localStorage.setItem('migration_completed', 'true')
      configurePullOptions(useProxyConfig.getState())
    } catch (error) {
      console.error('Migration failed:', error)
    }
  }
}
