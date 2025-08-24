import { useEffect } from 'react'
import { getTools } from '@/services/mcp'
import { MCPTool } from '@/types/completion'
import { SystemEvent } from '@/types/events'
import { useAppState } from './useAppState'
import { isPlatformTauri } from '@/lib/platform'
import type { TauriEventEmitter } from '@/types/tauri'

// Dynamic import for Tauri event listener
let listen: TauriEventEmitter['listen'] | null = null

if (isPlatformTauri()) {
  import('@tauri-apps/api/event').then(module => {
    listen = module.listen
  }).catch(() => {
    console.warn('Failed to load Tauri event module')
  })
}

export const useTools = () => {
  const { updateTools } = useAppState()

  useEffect(() => {
    function setTools() {
      getTools().then((data: MCPTool[]) => {
        updateTools(data)
      }).catch((error) => {
        console.error('Failed to fetch MCP tools:', error)
      })
    }
    setTools()

    let unsubscribe = () => {}
    if (listen) {
      listen(SystemEvent.MCP_UPDATE, setTools).then((unsub: () => void) => {
        // Unsubscribe from the event when the component unmounts
        unsubscribe = unsub
      }).catch((error: Error) => {
        console.error('Failed to set up MCP update listener:', error)
      })
    }
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
