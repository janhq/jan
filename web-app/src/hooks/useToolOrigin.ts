import { useMessages } from '@/hooks/useMessages'
import { useToolCallRuntime } from '@/hooks/useToolCallRuntime'
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
export const useToolOrigin = (toolName: string, toolCallId?: string, messageId?: string): ToolOrigin | undefined => {
  const liveMcpServer = useToolCallRuntime((s) =>
    toolCallId ? s.origins[toolCallId] : undefined
  )
  const storedMcpServer = useMessages((s) => {
    if (!toolCallId || !messageId) return undefined
    const message = Object.values(s.messages).flat().find((m) => m.id === messageId)
    const origins = message?.metadata?.toolOrigins as Record<string, string | null> | undefined
    return origins?.[toolCallId]
  })
  const boundMcpServer = liveMcpServer === undefined ? storedMcpServer : liveMcpServer
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
