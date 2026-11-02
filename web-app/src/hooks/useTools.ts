import { invalidateMcpValidation } from '@/lib/chatMcpIdentity'
import { useEffect } from 'react'
import { getServiceHub } from '@/hooks/useServiceHub'
import { SystemEvent } from '@/types/events'
import { useAppState } from './useAppState'
import { useToolAvailable } from './useToolAvailable'
import { ExtensionManager } from '@/lib/extension'
import { ExtensionTypeEnum, MCPExtension } from '@janhq/core'
import { mcpOrchestrator } from '@/lib/mcp-orchestrator/mcp-orchestrator'

export const useTools = () => {
  const updateTools = useAppState((state) => state.updateTools)
  const updateRagToolNames = useAppState((state) => state.updateRagToolNames)
  const updateMcpToolNames = useAppState((state) => state.updateMcpToolNames)
  const { isDefaultsInitialized, setDisabledTools, markDefaultsAsInitialized } = useToolAvailable()

  useEffect(() => {
    async function setTools() {
      invalidateMcpValidation()
      try {
        // A server connect/disconnect/tools-refresh fired this (mcp-update);
        // the orchestrator's per-request tool cache would otherwise only
        // notice via its own TTL, serving stale/reordered tools in the
        // meantime and destabilizing the KV-cache prefix Jan sends.
        mcpOrchestrator.invalidateCache()

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

        const mcpNames = mcpTools.map((t) => t.name)
        updateMcpToolNames(mcpNames)
        // Preserve overlaps: transport gives RAG names precedence over MCP tools.
        updateRagToolNames(ragToolNames)

        // Initialize default disabled tools for new users (only once)
        if (!isDefaultsInitialized() && mcpTools.length > 0 && mcpExtension?.getDefaultDisabledTools) {
          const defaultDisabled = await mcpExtension.getDefaultDisabledTools()
          if (defaultDisabled.length > 0) {
            setDisabledTools(defaultDisabled)
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
