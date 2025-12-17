/* eslint-disable @typescript-eslint/no-unused-vars */
import { createErrorResult } from '@/services/mcp-service'
import {
  ConnectionError,
  detectExtension,
  getToolSchemas,
  isChromeBrowser,
  McpWebClient,
  NotConnectedError,
  TimeoutError,
  ToolCallError,
  toToolResult,
  type ConnectionState,
  type DetectionResult,
  type ToolSchema,
} from '@janhq/mcp-web-client'

declare const BROWSER_SERVER_NAME: string
declare const EXTENSION_ID: string

export class JanBrowserClient implements ToolCallClient {
  private client?: McpWebClient
  private connectionState: ConnectionState = 'disconnected'
  private detectionResult: DetectionResult | null = null
  private onStateChange?: (state: ConnectionState) => void
  private reconnectIntervalId?: ReturnType<typeof setInterval>

  constructor() {
    this.connect()
    this.startReconnectInterval()
  }

  /**
   * Set callback for connection state changes
   */
  setOnStateChange(callback: (state: ConnectionState) => void): void {
    this.onStateChange = callback
    // Immediately notify with current state
    callback(this.connectionState)
  }

  /**
   * Get current connection state
   */
  getConnectionState(): ConnectionState {
    return this.connectionState
  }
  async getTools(): Promise<MCPTool[]> {
    return getToolSchemas().map((schema: ToolSchema) => {
      if (!Object.keys(schema.inputSchema.properties as object).length) {
        schema.inputSchema.properties = {
          __type: {
            type: 'string',
            description: 'Make it default to "default".',
            default: 'default',
          },
        }
        schema.inputSchema.required = ['__type']
      }

      return {
        name: schema.name,
        description: schema.description,
        inputSchema: schema.inputSchema,
        server: BROWSER_SERVER_NAME,
      }
    })
  }
  async callTool(
    payload: CallToolPayload,
    // @ts-expect-error unused parameter
    metadata?: { conversationId?: string; toolCallId?: string }
  ): Promise<MCPToolCallResult> {
    try {
      if (!this.client?.isConnected()) {
        return createErrorResult(
          'Browser extension not connected',
          'Browser extension is not connected. Please click the Browser button to connect.'
        )
      }
      const response = await this.client?.call(
        payload.toolName,
        payload.arguments
      )
      const toolResult = toToolResult(response)

      return {
        error: toolResult.isError
          ? toolResult.content[0]?.text || 'Tool call failed'
          : '',
        content: toolResult.content,
      }
    } catch (err) {
      let errorMessage: string

      if (err instanceof TimeoutError) {
        errorMessage = `Tool call timed out after ${(err as TimeoutError).timeoutMs}ms`
      } else if (err instanceof ToolCallError) {
        errorMessage = (err as ToolCallError).toolError || 'Tool call failed'
      } else if (err instanceof NotConnectedError) {
        errorMessage = 'Browser extension disconnected during tool call'
      } else if (err instanceof ConnectionError) {
        errorMessage = (err as Error).message
      } else {
        errorMessage = err instanceof Error ? err.message : String(err)
      }

      return createErrorResult(errorMessage)
    }
  }
  /**
   * Connect to the browser extension
   */
  async connect(): Promise<void> {
    await this.detectExtensionState()

    if (this.client?.isConnected()) {
      this.updateConnectionState('connected')
      return
    }

    if (!this.detectionResult?.isExtensionAvailable) {
      return
    }

    // Clean up old client
    if (this.client) {
      this.client.disconnect()
      this.client = undefined
    }

    // Create new client
    this.client = new McpWebClient({
      extensionId: EXTENSION_ID,
      timeout: 30000,
    })

    // Set up event handlers
    this.client.on('connect', () => {
      this.updateConnectionState('connected')
      console.log('Connected to browser extension MCP server')
    })

    this.client.on('disconnect', async () => {
      this.updateConnectionState('disconnected')
      // Immediately re-detect to check if extension still exists
      await this.detectExtensionState()
    })

    this.client.on('error', (error: Error) => {
      console.error('Browser extension error:', error)
      this.updateConnectionState('error')
    })

    this.client.on('stateChange', (state: ConnectionState) => {
      this.updateConnectionState(state)
    })

    // Connect (synchronous)
    this.client.connect()
  }

  /**
   * Update connection state and notify callback
   */
  private updateConnectionState(state: ConnectionState): void {
    this.connectionState = state
    this.onStateChange?.(state)
  }

  /**
   * Detect extension state (installed/available)
   */
  private async detectExtensionState(): Promise<DetectionResult> {
    try {
      this.detectionResult = await detectExtension(EXTENSION_ID, 3000)
    } catch (error) {
      this.detectionResult = {
        isChrome: isChromeBrowser(),
        hasChromeRuntime: false,
        isExtensionAvailable: false,
        error: error instanceof Error ? error.message : 'Detection failed',
      }
    }
    // this.notifyStateChange()
    return this.detectionResult
  }

  /**
   * Start automatic reconnection interval
   */
  private startReconnectInterval(): void {
    // Clear any existing interval
    if (this.reconnectIntervalId) {
      clearInterval(this.reconnectIntervalId)
    }

    // Try to reconnect every 10 seconds if not connected
    this.reconnectIntervalId = setInterval(async () => {
      if (!this.client?.isConnected()) {
        console.log('Attempting to reconnect to browser extension...')
        await this.connect()
      }
    }, 5000)
  }

  /**
   * Stop automatic reconnection interval
   */
  private stopReconnectInterval(): void {
    if (this.reconnectIntervalId) {
      clearInterval(this.reconnectIntervalId)
      this.reconnectIntervalId = undefined
    }
  }

  /**
   * Disconnect from the browser extension
   */
  async disconnect(): Promise<void> {
    this.stopReconnectInterval()
    if (this.client) {
      this.client.disconnect()
      this.client = undefined
    }
    this.updateConnectionState('disconnected')
  }

  /**
   * Refreshes the tools list by re-fetching from the server
   * Reinitializes the client to get fresh data
   * @returns Promise<MCPTool[]> - Updated list of tools
   */
  async refreshTools(): Promise<void> {}

  /**
   * Checks if the MCP client is healthy and connected
   * @returns Promise<boolean> - true if client is connected and operational
   */
  async isHealthy(): Promise<boolean> {
    return (
      this.connectionState === 'connected' &&
      (this.client?.isConnected() ?? false)
    )
  }
}
