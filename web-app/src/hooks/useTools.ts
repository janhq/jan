import { useEffect } from 'react'
import { getServiceHub } from '@/hooks/useServiceHub'
import { MCPTool } from '@/types/completion'
import { SystemEvent } from '@/types/events'
import { useAppState } from './useAppState'

export const useTools = () => {
  const { updateTools } = useAppState()

  useEffect(() => {
    function setTools() {
      getServiceHub().mcp().getTools().then((data: MCPTool[]) => {
        updateTools(data)
      }).catch((error) => {
        console.error('Failed to fetch MCP tools:', error)
      })
    }
    setTools()

    let unsubscribe = () => {}
    getServiceHub().events().listen(SystemEvent.MCP_UPDATE, setTools).then((unsub) => {
      // Unsubscribe from the event when the component unmounts
      unsubscribe = unsub
    }).catch((error) => {
      console.error('Failed to set up MCP update listener:', error)
    })
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
