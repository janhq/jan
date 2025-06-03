import { useModelProvider } from '@/hooks/useModelProvider'
import { ExtensionManager } from '@/lib/extension'
import {
  EngineManagementExtension,
  Engines,
  ExtensionTypeEnum,
} from '@janhq/core'

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
    } catch (error) {
      console.error('Migration failed:', error)
    }
  }
}
