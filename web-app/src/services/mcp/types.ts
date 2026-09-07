/**
 * MCP Service Types
 */

import { MCPTool, MCPToolCallResult } from '@janhq/core'
import type { MCPServerConfig, MCPServers, MCPSettings } from '@/hooks/useMCPServers'

export interface MCPConfig {
  mcpServers?: MCPServers
  mcpSettings?: MCPSettings
}

export interface ToolCallWithCancellationResult {
  promise: Promise<MCPToolCallResult>
  cancel: () => Promise<void>
  token: string
}

/** Lightweight server metadata used by the orchestrator for tool routing. */
export interface ServerSummary {
  name: string
  capabilities: string[]
  description: string
}

/**
 * OAuth state of one remote MCP server, as reported by `get_mcp_auth_status`.
 * Derived entirely on the Rust side so the UI never re-implements the rules
 * (a hand-written `Authorization` header, for instance, means OAuth is neither
 * offered nor reported as missing).
 */
export interface MCPAuthStatus {
  state:
    | 'notApplicable'
    | 'staticHeader'
    | 'authenticated'
    | 'expired'
    | 'staleResource'
    | 'unauthenticated'
  /** Whether an interactive sign-in is possible and would mean something. */
  canAuthenticate: boolean
  /** Whether there are stored tokens to forget. */
  hasCredentials: boolean
  /**
   * Whether a stored refresh token can renew this without the browser. Only
   * meaningful for `expired`; false everywhere else.
   */
  renewable: boolean
  /** Unix seconds the access token expires at, when known. */
  expiresAt: number | null
}

export interface MCPService {
  updateMCPConfig(configs: string): Promise<void>
  restartMCPServers(): Promise<void>
  getMCPConfig(): Promise<MCPConfig>
  getTools(): Promise<MCPTool[]>
  /** Fetch tools from a specific subset of servers. */
  getToolsForServers(serverNames: string[]): Promise<MCPTool[]>
  /** Return name/capabilities/description for all connected servers. */
  getServerSummaries(): Promise<ServerSummary[]>
  getConnectedServers(): Promise<string[]>
  /**
   * `maxOutputChars` is a per-result character budget derived from the active
   * model's context window; the backend narrows its own configured cap to it so
   * one oversized result cannot exhaust the context.
   */
  callTool(args: {
    toolName: string
    serverName?: string
    arguments: object
    maxOutputChars?: number
  }): Promise<MCPToolCallResult>
  callToolWithCancellation(args: {
    toolName: string
    serverName?: string
    arguments: object
    cancellationToken?: string
  }): ToolCallWithCancellationResult
  cancelToolCall(cancellationToken: string): Promise<void>

  // MCP Server lifecycle management
  activateMCPServer(name: string, config: MCPServerConfig): Promise<void>
  deactivateMCPServer(name: string): Promise<void>
  checkJanBrowserExtensionConnected(): Promise<boolean>

  // OAuth for remote (http/sse) servers
  /** Local read, no network: safe to call per row. */
  getMCPAuthStatus(name: string): Promise<MCPAuthStatus>
  /**
   * Run the full interactive authorization. Resolves only once the browser
   * redirect has been exchanged for tokens, so expect this to be pending for as
   * long as the user takes (the backend gives up after five minutes).
   */
  authorizeMCPServer(name: string): Promise<void>
  /** Forget stored tokens. `false` when there were none. */
  clearMCPAuth(name: string): Promise<boolean>
}
