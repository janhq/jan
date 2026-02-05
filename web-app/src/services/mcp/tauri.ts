/**
 * Tauri MCP Service - Desktop implementation
 */

import { invoke } from '@tauri-apps/api/core'
import { MCPTool } from '@/types/completion'
import { DEFAULT_MCP_SETTINGS } from '@/hooks/useMCPServers'
import type { MCPServerConfig, MCPServers, MCPSettings } from '@/hooks/useMCPServers'
import type { MCPConfig } from './types'
import { DefaultMCPService } from './default'

export class TauriMCPService extends DefaultMCPService {
  async updateMCPConfig(configs: string): Promise<void> {
    await window.core?.api?.saveMcpConfigs({ configs })
  }

  async restartMCPServers(): Promise<void> {
    await window.core?.api?.restartMcpServers()
  }

  async getMCPConfig(): Promise<MCPConfig> {
    const rawConfig = await window.core?.api?.getMcpConfigs()
    const configString = typeof rawConfig === 'string' ? rawConfig.trim() : ''

    const defaultResponse = (): MCPConfig => ({
      mcpServers: {},
      mcpSettings: { ...DEFAULT_MCP_SETTINGS },
    })

    if (!configString) {
      return defaultResponse()
    }

    const parsed = JSON.parse(configString) as MCPConfig & Record<string, unknown>

    if (!parsed || typeof parsed !== 'object') {
      return defaultResponse()
    }

    const { mcpServers, mcpSettings, ...legacyServers } = parsed
    const hasLegacyServers = Object.keys(legacyServers).length > 0

    const normalizedServers: MCPServers =
      (isPlainObject(mcpServers) ? (mcpServers as MCPServers) : undefined) ??
      (hasLegacyServers && isPlainObject(legacyServers)
        ? (legacyServers as MCPServers)
        : ({} as MCPServers))

    const normalizedSettings: MCPSettings = {
      ...DEFAULT_MCP_SETTINGS,
      ...(isPlainObject(mcpSettings) ? (mcpSettings as MCPSettings) : {}),
    }

    return {
      mcpServers: normalizedServers,
      mcpSettings: normalizedSettings,
    }
  }

  async getTools(): Promise<MCPTool[]> {
    return window.core?.api?.getTools()
  }

  async getConnectedServers(): Promise<string[]> {
    return window.core?.api?.getConnectedServers()
  }

  async callTool(args: {
    toolName: string
    serverName?: string
    arguments: object
  }): Promise<{ error: string; content: { text: string }[] }> {
    return window.core?.api?.callTool(args)
  }

  callToolWithCancellation(args: {
    toolName: string
    serverName?: string
    arguments: object
    cancellationToken?: string
  }): {
    promise: Promise<{ error: string; content: { text: string }[] }>
    cancel: () => Promise<void>
    token: string
  } {
    // Generate a unique cancellation token if not provided
    const token = args.cancellationToken ?? `tool_call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    // Create the tool call promise with cancellation token
    const promise = window.core?.api?.callTool({
      ...args,
      cancellationToken: token
    })

    // Create cancel function
    const cancel = async () => {
      await window.core?.api?.cancelToolCall({ cancellationToken: token })
    }

    return { promise, cancel, token }
  }

  async cancelToolCall(cancellationToken: string): Promise<void> {
    return await window.core?.api?.cancelToolCall({ cancellationToken })
  }

  async activateMCPServer(name: string, config: MCPServerConfig): Promise<void> {
    return await invoke('activate_mcp_server', { name, config })
  }

  async deactivateMCPServer(name: string): Promise<void> {
    return await invoke('deactivate_mcp_server', { name })
  }

  async checkJanBrowserExtensionConnected(): Promise<boolean> {
    return await invoke('check_jan_browser_extension_connected')
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
