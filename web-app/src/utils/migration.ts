import { useProductAnalytic } from '@/hooks/useAnalytic'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useProxyConfig } from '@/hooks/useProxyConfig'
import { invoke } from '@tauri-apps/api/core'

/**
 * Migrates legacy browser data to new browser session.
 */
export const migrateData = async () => {
  if (!localStorage.getItem('migration_completed')) {
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
    localStorage.setItem('migration_completed', 'true')
  }
}
