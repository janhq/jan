import { useEffect } from 'react'
import { SystemEvent } from '@/types/events'
import { getServiceHub } from '@/hooks/useServiceHub'
import { useAppState } from './useAppState'

export function usePrompts() {
  const updatePrompts = useAppState((state) => state.updateMcpPrompts)

  useEffect(() => {
    const fetchPrompts = async () => {
      try {
        const prompts = await getServiceHub().mcp().getPrompts()
        updatePrompts(prompts)
      } catch (err) {
        console.error('Failed to fetch MCP prompts: ', err)
      }
    }
    fetchPrompts()

    // Go through the service hub rather than Tauri's `listen` directly, so the
    // hook also works where there is no Tauri runtime (browser, tests).
    let unsubscribe = () => {}
    getServiceHub()
      .events()
      .listen(SystemEvent.MCP_UPDATE, fetchPrompts)
      .then((unsub) => {
        unsubscribe = unsub
      })
      .catch((error) => {
        console.error('Failed to set up MCP update listener:', error)
      })
    return unsubscribe
  }, [updatePrompts])
}
