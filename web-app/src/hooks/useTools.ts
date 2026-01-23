import { useEffect } from 'react'
import { getServiceHub } from '@/hooks/useServiceHub'
import { SystemEvent } from '@/types/events'
import { useAppState } from './useAppState'
import { useToolAvailable } from './useToolAvailable'
import { ExtensionManager } from '@/lib/extension'
import { ExtensionTypeEnum, MCPExtension } from '@janhq/core'

export const useTools = () => {
  const updateTools = useAppState((state) => state.updateTools)
  const updateRagToolNames = useAppState((state) => state.updateRagToolNames)
  const updateMcpToolNames = useAppState((state) => state.updateMcpToolNames)
  const { isDefaultsInitialized, setDefaultDisabledTools, markDefaultsAsInitialized } = useToolAvailable()

  useEffect(() => {
    async function setTools() {
      try {
        // Get MCP extension first
        const mcpExtension = ExtensionManager.getInstance().get<MCPExtension>(
          ExtensionTypeEnum.MCP
        )

        // Fetch tools and tool names in parallel
        const [mcpTools, ragToolNames] = await Promise.all([
          getServiceHub().mcp().getTools(),
          getServiceHub().rag().getToolNames?.() ?? Promise.resolve([]),
        ])

        // Update MCP tools
        updateTools(mcpTools)

        // Update cached tool names for fast synchronous access
        updateMcpToolNames(mcpTools.map((t) => t.name))
        updateRagToolNames(ragToolNames)

        // Initialize default disabled tools for new users (only once)
        if (!isDefaultsInitialized() && mcpTools.length > 0 && mcpExtension?.getDefaultDisabledTools) {
          const defaultDisabled = await mcpExtension.getDefaultDisabledTools()
          if (defaultDisabled.length > 0) {
            setDefaultDisabledTools(defaultDisabled)
            markDefaultsAsInitialized()
          }
        }
      } catch (error) {
        console.error('Failed to fetch MCP tools:', error)
      }
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
