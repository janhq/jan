import { MCPInterface, MCPTool, MCPToolCallResult } from '../../types'
import { BaseExtension, ExtensionTypeEnum } from '../extension'

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
  abstract callTool(toolName: string, args: Record<string, unknown>): Promise<MCPToolCallResult>
  abstract getConnectedServers(): Promise<string[]>
  abstract refreshTools(): Promise<void>
  abstract isHealthy(): Promise<boolean>
}