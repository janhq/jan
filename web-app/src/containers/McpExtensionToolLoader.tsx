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
    const tool = tools.find(t => t.name === toolName)
    if (!tool) return

    const toolKey = `${tool.server}::${toolName}`

    if (initialMessage) {
      const currentDefaults = getDefaultDisabledTools()
      if (enabled) {
        setDefaultDisabledTools(currentDefaults.filter((key) => key !== toolKey))
      } else {
        setDefaultDisabledTools([...currentDefaults, toolKey])
      }
    } else if (currentThread?.id) {
      setToolDisabledForThread(currentThread.id, tool.server, toolName, enabled)
    }
  }

  const isToolEnabled = (toolName: string): boolean => {
    const tool = tools.find(t => t.name === toolName)
    if (!tool) return false

    const toolKey = `${tool.server}::${toolName}`

    if (initialMessage) {
      return !getDefaultDisabledTools().includes(toolKey)
    } else if (currentThread?.id) {
      return !isToolDisabled(currentThread.id, tool.server, toolName)
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
