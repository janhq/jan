import { useEffect } from 'react'
import { getServiceHub } from '@/hooks/useServiceHub'
import { SystemEvent } from '@/types/events'
import { useAppState } from './useAppState'
import { useToolAvailable } from './useToolAvailable'
import { ExtensionManager } from '@/lib/extension'
import { ExtensionTypeEnum, MCPExtension } from '@janhq/core'
import { useAttachments } from './useAttachments'
import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformFeature } from '@/lib/platform/types'

export const useTools = () => {
  const updateTools = useAppState((state) => state.updateTools)
  const { isDefaultsInitialized, setDefaultDisabledTools, markDefaultsAsInitialized } = useToolAvailable()
  const attachmentsEnabled = useAttachments((s) => s.enabled)

  useEffect(() => {
    async function setTools() {
      try {
        // Get MCP extension first
        const mcpExtension = ExtensionManager.getInstance().get<MCPExtension>(
          ExtensionTypeEnum.MCP
        )

        // Fetch tools
        const [mcpTools, ragTools] = await Promise.all([
          getServiceHub().mcp().getTools(),
          // Only include RAG tools when attachments feature is enabled
          useAttachments.getState().enabled && PlatformFeatures[PlatformFeature.ATTACHMENTS]
            ? getServiceHub().rag().getTools()
            : Promise.resolve([]),
        ])

        const combined = [...mcpTools, ...ragTools]
        updateTools(combined)

        // Initialize default disabled tools for new users (only once)
        if (!isDefaultsInitialized() && combined.length > 0 && mcpExtension?.getDefaultDisabledTools) {
          const defaultDisabled = await mcpExtension.getDefaultDisabledTools()
          if (defaultDisabled.length > 0) {
            setDefaultDisabledTools(defaultDisabled)
            markDefaultsAsInitialized()
          }
        }
      } catch (error) {
        console.error('Failed to fetch tools:', error)
      }
    }
    setTools()

    let unsubscribe = () => {}
    getServiceHub().events().listen(SystemEvent.MCP_UPDATE, setTools).then((unsub) => {
      // Unsubscribe from the event when the component unmounts
      unsubscribe = unsub
    }).catch((error) => {
      console.error('Failed to set up tools update listener:', error)
    })
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Refresh tools when attachments feature toggles
  useEffect(() => {
    getServiceHub().events().emit(SystemEvent.MCP_UPDATE)
  }, [attachmentsEnabled])
}
