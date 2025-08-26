/**
 * Tauri MCP Service - Desktop implementation
 * 
 * Currently uses default implementation as MCP is handled through window.core API
 */

import { getServiceHub } from '../index'
import { DefaultMCPService } from './default'

export class TauriMCPService extends DefaultMCPService {
  // MCP Server lifecycle management - using invoke
  async activateMCPServer(name: string, config: import('@/hooks/useMCPServers').MCPServerConfig): Promise<void> {
    try {
      await getServiceHub().core().invoke('activate_mcp_server', { 
        name, 
        config: {
          ...config,
          active: true
        }
      })
    } catch (error) {
      console.error('Error activating MCP server in Tauri, falling back to default:', error)
      return super.activateMCPServer(name, config)
    }
  }

  async deactivateMCPServer(name: string): Promise<void> {
    try {
      await getServiceHub().core().invoke('deactivate_mcp_server', { name })
    } catch (error) {
      console.error('Error deactivating MCP server in Tauri, falling back to default:', error)
      return super.deactivateMCPServer(name)
    }
  }
}