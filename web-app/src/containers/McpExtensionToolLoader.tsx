import { ComponentType } from 'react'
import { MCPTool, MCPToolComponentProps } from '@janhq/core'
import { useToolAvailable } from '@/hooks/useToolAvailable'
import { useThreads } from '@/hooks/useThreads'

interface McpExtensionToolLoaderProps {
  tools: MCPTool[]
  hasActiveMCPServers: boolean
  selectedModelHasTools: boolean
  initialMessage?: boolean
  MCPToolComponent?: ComponentType<MCPToolComponentProps> | null
}

export const McpExtensionToolLoader = ({
  tools,
  hasActiveMCPServers,
  selectedModelHasTools,
  initialMessage,
  MCPToolComponent,
}: McpExtensionToolLoaderProps) => {
  // Get tool management hooks
  const { isToolDisabled, setToolDisabledForThread, setDefaultDisabledTools, getDefaultDisabledTools } = useToolAvailable()
  const { getCurrentThread } = useThreads()
  const currentThread = getCurrentThread()

  // Handle tool toggle for custom component
  const handleToolToggle = (toolName: string, enabled: boolean) => {
    if (initialMessage) {
      const currentDefaults = getDefaultDisabledTools()
      if (enabled) {
        setDefaultDisabledTools(currentDefaults.filter((name) => name !== toolName))
      } else {
        setDefaultDisabledTools([...currentDefaults, toolName])
      }
    } else if (currentThread?.id) {
      setToolDisabledForThread(currentThread.id, toolName, enabled)
    }
  }

  const isToolEnabled = (toolName: string): boolean => {
    if (initialMessage) {
      return !getDefaultDisabledTools().includes(toolName)
    } else if (currentThread?.id) {
      return !isToolDisabled(currentThread.id, toolName)
    }
    return false
  }

  // Only render if we have the custom MCP component and conditions are met
  if (!selectedModelHasTools || !hasActiveMCPServers || !MCPToolComponent) {
    return null
  }

  return (
    <MCPToolComponent
      tools={tools}
      isToolEnabled={isToolEnabled}
      onToolToggle={handleToolToggle}
    />
  )
}
