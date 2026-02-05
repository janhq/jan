import { MCPInterface, MCPTool, MCPToolCallResult, MCPToolComponentProps } from '../../types'
import { BaseExtension, ExtensionTypeEnum } from '../extension'
import type { ComponentType } from 'react'

/**
 * MCP (Model Context Protocol) extension for managing tools and server communication.
 * @extends BaseExtension
 */
export abstract class MCPExtension extends BaseExtension implements MCPInterface {
  /**
   * MCP extension type.
   */
  type(): ExtensionTypeEnum | undefined {
    return ExtensionTypeEnum.MCP
  }

  abstract getTools(): Promise<MCPTool[]>
  abstract callTool(toolName: string, args: Record<string, unknown>, serverName?: string): Promise<MCPToolCallResult>
  abstract getConnectedServers(): Promise<string[]>
  abstract refreshTools(): Promise<void>
  abstract isHealthy(): Promise<boolean>

  /**
   * Optional method to provide a custom UI component for tools
   * @returns A React component or null if no custom component is provided
   */
  getToolComponent?(): ComponentType<MCPToolComponentProps> | null

  /**
   * Optional method to get the list of tool names that should be disabled by default
   * @returns Array of tool names that should be disabled by default for new users
   */
  getDefaultDisabledTools?(): Promise<string[]>
}
