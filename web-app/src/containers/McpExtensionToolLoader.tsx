import { ComponentType } from 'react'
import { MCPTool, MCPToolComponentProps } from '@janhq/core'
import { useToolAvailable } from '@/hooks/useToolAvailable'

interface McpExtensionToolLoaderProps {
  tools: MCPTool[]
  hasActiveMCPServers: boolean
  selectedModelHasTools: boolean
  MCPToolComponent?: ComponentType<MCPToolComponentProps> | null
}

export const McpExtensionToolLoader = ({
  tools,
  hasActiveMCPServers,
  selectedModelHasTools,
  MCPToolComponent,
}: McpExtensionToolLoaderProps) => {
  const { isToolDisabled, setToolDisabled } = useToolAvailable()

  const handleToolToggle = (toolName: string, enabled: boolean) => {
    const tool = tools.find((t) => t.name === toolName)
    if (!tool) return
    setToolDisabled(tool.server, toolName, enabled)
  }

  const isToolEnabled = (toolName: string): boolean => {
    const tool = tools.find((t) => t.name === toolName)
    if (!tool) return false
    return !isToolDisabled(tool.server, toolName)
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
