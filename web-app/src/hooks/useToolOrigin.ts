import { useMemo } from 'react'
import { useAppState } from '@/hooks/useAppState'
import { getProviderMeta, useWebSearchConfig } from '@/hooks/useWebSearchConfig'
import { resolveToolOrigin, type ToolOrigin } from '@/lib/toolOrigin'
import { AGENT_TOOL_NAMES } from '@/lib/agentTools'

/**
 * Resolve which family a tool call belongs to. Each selector returns a
 * primitive so a refreshed-but-equivalent tool list does not re-render every
 * card on screen.
 */
export const useToolOrigin = (toolName: string): ToolOrigin | undefined => {
  const mcpServer = useAppState(
    (s) => s.tools.find((tool) => tool.name === toolName)?.server
  )
  const isRagTool = useAppState((s) => s.ragToolNames.has(toolName))
  const isAgentTool = AGENT_TOOL_NAMES.has(toolName)
  const webSearchProviderLabel = useWebSearchConfig(
    (s) => getProviderMeta(s.searchProvider).label
  )

  return useMemo(
    () =>
      resolveToolOrigin(toolName, {
        mcpServer,
        isRagTool,
        isAgentTool,
        webSearchProviderLabel,
      }),
    [toolName, mcpServer, isRagTool, isAgentTool, webSearchProviderLabel]
  )
}
