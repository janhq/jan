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
import { CONNECTION_STATE } from '@/constants'

declare const BROWSER_SERVER_NAME: string
declare const EXTENSION_ID: string

export class JanBrowserClient implements ToolCallClient {
  private client?: McpWebClient
  private connectionState: ConnectionState = CONNECTION_STATE.DISCONNECTED
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
    metadata?: { conversationId?: string; toolCallId?: string; signal?: AbortSignal }
  ): Promise<MCPToolCallResult> {
    try {
      // Check if already aborted
      if (metadata?.signal?.aborted) {
        return createErrorResult('Tool call was cancelled')
      }

      if (!this.client?.isConnected()) {
        return createErrorResult(
          'Browser extension not connected',
          'Browser extension is not connected. Please click the Browser button to connect.'
        )
      }

      // Create a promise that can be cancelled
      const toolCallPromise = this.client?.call(
        payload.toolName,
        payload.arguments
      )

      // If we have an abort signal, race the tool call with abort
      let response
      if (metadata?.signal) {
        const abortPromise = new Promise<never>((_, reject) => {
          metadata.signal?.addEventListener('abort', () => {
            reject(new Error('Tool call was cancelled'))
          })
        })
        response = await Promise.race([toolCallPromise, abortPromise])
      } else {
        response = await toolCallPromise
      }

      const toolResult = toToolResult(response)

      return {
        error: toolResult.isError
          ? toolResult.content[0]?.text || 'Tool call failed'
          : '',
        content: toolResult.content,
      }
    } catch (err) {
      // Handle abort errors
      if (err instanceof Error && err.message === 'Tool call was cancelled') {
        console.log(`Browser tool call ${payload.toolName} was cancelled`)
        return createErrorResult('Tool call was cancelled')
      }

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
      this.updateConnectionState(CONNECTION_STATE.CONNECTED)
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
      this.updateConnectionState(CONNECTION_STATE.CONNECTED)
      console.log('Connected to browser extension MCP server')
    })

    this.client.on('disconnect', async () => {
      this.updateConnectionState(CONNECTION_STATE.DISCONNECTED)
      // Immediately re-detect to check if extension still exists
      await this.detectExtensionState()
    })

    this.client.on('error', (error: Error) => {
      console.error('Browser extension error:', error)
      this.updateConnectionState(CONNECTION_STATE.ERROR)
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
    this.updateConnectionState(CONNECTION_STATE.DISCONNECTED)
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
      this.connectionState === CONNECTION_STATE.CONNECTED &&
      (this.client?.isConnected() ?? false)
    )
  }
}
