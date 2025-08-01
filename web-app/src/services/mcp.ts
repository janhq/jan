import { MCPTool } from '@/types/completion'

/**
 * @description This file contains the functions to interact with the MCP API.
 * It includes functions to get and update the MCP configuration.
 * @param configs
 */
export const updateMCPConfig = async (configs: string) => {
  await window.core?.api?.saveMcpConfigs({ configs })
}

/**
 * @description This function restarts the MCP servers.
 * @param configs
 */
export const restartMCPServers = async () => {
  await window.core?.api?.restartMcpServers()
}

/**
 * @description This function gets the MCP configuration.
 * @returns {Promise<object>} The MCP configuration.
 */
export const getMCPConfig = async () => {
  const configString = (await window.core?.api?.getMcpConfigs()) ?? '{}'
  const mcpConfig = JSON.parse(configString || '{}')
  return mcpConfig
}

/**
 * @description This function gets the MCP configuration.
 * @returns {Promise<string>} The MCP configuration.
 */
export const getTools = (): Promise<MCPTool[]> => {
  return window.core?.api?.getTools()
}

/**
 * @description This function gets connected MCP servers.
 * @returns {Promise<string[]>} The MCP names
 * @returns
 */
export const getConnectedServers = (): Promise<string[]> => {
  return window.core?.api?.getConnectedServers()
}

/**
 * @description This function invoke an MCP tool
 * @param tool
 * @param params
 * @returns
 */
export const callTool = (args: {
  toolName: string
  arguments: object
}): Promise<{ error: string; content: { text: string }[] }> => {
  return window.core?.api?.callTool(args)
}
