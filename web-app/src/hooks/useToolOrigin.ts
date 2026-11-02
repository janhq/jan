import { useMessages } from '@/hooks/useMessages'
import { toolOriginKey, useToolCallRuntime } from '@/hooks/useToolCallRuntime'
import { useMemo } from 'react'
import { useAppState } from '@/hooks/useAppState'
import { getProviderMeta, useWebSearchConfig } from '@/hooks/useWebSearchConfig'
import { resolveToolOrigin, type ToolOrigin } from '@/lib/toolOrigin'
import { AGENT_TOOL_NAMES, isRecordedShellCall } from '@/lib/agentTools'

/**
 * Resolve which family a tool call belongs to. Each selector returns a
 * primitive so a refreshed-but-equivalent tool list does not re-render every
 * card on screen.
 */
export const useToolOrigin = (toolName: string, toolCallId?: string, messageId?: string, threadId?: string): ToolOrigin | undefined => {
  const liveMcpServer = useToolCallRuntime((s) =>
    toolCallId ? s.origins[toolOriginKey(threadId, toolCallId)] : undefined
  )
  const storedMcpServer = useMessages((s) => {
    if (!toolCallId || !messageId || !threadId) return undefined
    const message = s.messages[threadId]?.find((m) => m.id === messageId)
    const origins = message?.metadata?.toolOrigins as Record<string, string | null> | undefined
    return origins?.[toolCallId]
  })
  const boundMcpServer = storedMcpServer === undefined ? liveMcpServer : storedMcpServer
  const mcpServer = useAppState(
    (s) => s.tools.find((tool) => tool.name === toolName)?.server
  )
  const isRagTool = useAppState((s) => s.ragToolNames.has(toolName))
  const isAgentTool =
    AGENT_TOOL_NAMES.has(toolName) || isRecordedShellCall(toolName)
  const webSearchProviderLabel = useWebSearchConfig(
    (s) => getProviderMeta(s.searchProvider).label
  )
  const webSearchEnabled = useWebSearchConfig((s) => s.webSearchEnabled)

  return useMemo(
    () =>
      resolveToolOrigin(toolName, {
        mcpServer,
        boundMcpServer,
        isRagTool,
        isAgentTool,
        webSearchProviderLabel,
        webSearchEnabled,
      }),
    [
      toolName,
      mcpServer,
      boundMcpServer,
      isRagTool,
      isAgentTool,
      webSearchProviderLabel,
      webSearchEnabled,
    ]
  )
}
