import { useEffect } from 'react'
import { getTools } from '@/services/mcp'
import { MCPTool } from '@/types/completion'
import { listen } from '@tauri-apps/api/event'
import { SystemEvent } from '@/types/events'
import { useAppState } from './useAppState'

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
    listen(SystemEvent.MCP_UPDATE, setTools).then((unsub) => {
      // Unsubscribe from the event when the component unmounts
      unsubscribe = unsub
    }).catch((error) => {
      console.error('Failed to set up MCP update listener:', error)
    })
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
