
/**
 * @description This file contains the functions to interact with the MCP API.
 * It includes functions to get and update the MCP configuration.
 * @param configs 
 */
export const updateMCPConfig = async (configs: string) => {
  await window.core?.api?.saveMcpConfigs({ configs })
  await window.core?.api?.restartMcpServers()
}
