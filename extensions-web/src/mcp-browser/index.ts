import { MCPExtension, MCPTool, MCPToolCallResult, MCPToolComponentProps } from '@janhq/core'
import {
  McpWebClient,
  detectExtension,
  isChromeBrowser,
  ConnectionState,
  DetectionResult,
  ConnectionError,
  NotConnectedError,
  ToolCallError,
  TimeoutError,
  toToolResult,
} from '@janhq/mcp-web-client'
import type { ComponentType } from 'react'
import { getBrowserTools, BROWSER_SERVER_NAME, isBrowserTool } from './tools'
import { BrowserToolButton } from './components'
import { createErrorResult, normalizeContentItem } from '../shared/mcp-utils'
import { isEmbedded, resolveExtensionId } from '../shared/extension-embedding'

export interface BrowserExtensionState {
  connectionState: ConnectionState
  isExtensionInstalled: boolean
  isBrowserSupported: boolean
  isEmbedded: boolean
  extensionId: string
}

export interface BrowserToolComponentProps extends MCPToolComponentProps {
  getState: () => BrowserExtensionState
  subscribeToState: (callback: () => void) => () => void
  onConnect: () => void
}

export default class MCPBrowserExtension extends MCPExtension {
  private client: McpWebClient | null = null
  private connectionState: ConnectionState = 'disconnected'
  private extensionId: string
  private detectionResult: DetectionResult | null = null
  private stateListeners = new Set<() => void>()
  private pollingInterval: ReturnType<typeof setInterval> | null = null
  private readonly POLL_INTERVAL = 10000
  private cachedSnapshot: BrowserExtensionState | null = null

  constructor(
    url: string,
    name: string,
    productName?: string,
    active?: boolean,
    description?: string,
    version?: string
  ) {
    super(url, name, productName, active, description, version)
    this.extensionId = resolveExtensionId()
  }

  async onLoad(): Promise<void> {
    if (!isChromeBrowser()) return

    await this.detectExtensionState()

    if (this.detectionResult?.isExtensionAvailable) {
      try {
        this.connect()
      } catch {
        // Ignore auto-connect failures
      }
    }

    if (this.connectionState !== 'connected') {
      this.startPolling()
    }
  }

  async onUnload(): Promise<void> {
    this.stopPolling()
    this.disconnect()
    this.stateListeners.clear()
  }

  private async detectExtensionState(): Promise<DetectionResult> {
    try {
      this.detectionResult = await detectExtension(this.extensionId, 3000)
    } catch (error) {
      this.detectionResult = {
        isChrome: isChromeBrowser(),
        hasChromeRuntime: false,
        isExtensionAvailable: false,
        error: error instanceof Error ? error.message : 'Detection failed',
      }
    }
    this.notifyStateChange()
    return this.detectionResult
  }

  private startPolling(): void {
    if (this.pollingInterval) return

    this.pollingInterval = setInterval(async () => {
      const prevInstalled = this.detectionResult?.isExtensionAvailable ?? false
      await this.detectExtensionState()
      const nowInstalled = this.detectionResult?.isExtensionAvailable ?? false

      if (!prevInstalled && nowInstalled && !this.client?.isConnected()) {
        try {
          this.connect()
        } catch {
          // Ignore auto-connect failures
        }
      }
    }, this.POLL_INTERVAL)
  }

  private stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval)
      this.pollingInterval = null
    }
  }

  getConnectionState(): ConnectionState {
    return this.connectionState
  }

  isBrowserSupported(): boolean {
    return isChromeBrowser()
  }

  connect(): void {
    if (this.client?.isConnected()) return

    if (!this.detectionResult?.isExtensionAvailable) {
      throw new ConnectionError('Browser extension is not installed')
    }

    if (this.client) {
      this.client.disconnect()
      this.client = null
    }

    this.client = new McpWebClient({
      extensionId: this.extensionId,
      timeout: 30000,
    })

    this.client.on('connect', () => this.setConnectionState('connected'))
    this.client.on('disconnect', async () => {
      this.setConnectionState('disconnected')
      await this.detectExtensionState()
    })
    this.client.on('error', () => this.setConnectionState('error'))
    this.client.on('stateChange', (state: ConnectionState) => this.setConnectionState(state))

    this.client.connect()
  }

  disconnect(): void {
    if (this.client) {
      this.client.disconnect()
      this.client = null
    }
    this.setConnectionState('disconnected')
  }

  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState === state) return

    const wasConnected = this.connectionState === 'connected'
    this.connectionState = state

    if (state === 'connected') {
      this.stopPolling()
      if (!wasConnected && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('mcp-browser-connected'))
      }
    } else {
      this.startPolling()
    }

    this.notifyStateChange()
  }

  getStateSnapshot = (): BrowserExtensionState => {
    const isExtensionInstalled = this.detectionResult?.isExtensionAvailable ?? false
    const isBrowserSupported = this.isBrowserSupported()
    const embedded = isEmbedded()

    if (
      this.cachedSnapshot &&
      this.cachedSnapshot.connectionState === this.connectionState &&
      this.cachedSnapshot.isExtensionInstalled === isExtensionInstalled &&
      this.cachedSnapshot.isBrowserSupported === isBrowserSupported &&
      this.cachedSnapshot.isEmbedded === embedded &&
      this.cachedSnapshot.extensionId === this.extensionId
    ) {
      return this.cachedSnapshot
    }

    this.cachedSnapshot = {
      connectionState: this.connectionState,
      isExtensionInstalled,
      isBrowserSupported,
      isEmbedded: embedded,
      extensionId: this.extensionId,
    }
    return this.cachedSnapshot
  }

  subscribeToState = (callback: () => void): (() => void) => {
    this.stateListeners.add(callback)
    return () => this.stateListeners.delete(callback)
  }

  private notifyStateChange(): void {
    this.stateListeners.forEach((cb) => {
      try {
        cb()
      } catch {
        // Ignore listener errors
      }
    })
  }

  async getTools(): Promise<MCPTool[]> {
    return this.connectionState === 'connected' ? getBrowserTools() : []
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    _serverName?: string
  ): Promise<MCPToolCallResult> {
    if (!isBrowserTool(toolName)) {
      return createErrorResult(`Unknown browser tool: ${toolName}`)
    }

    if (!this.client?.isConnected()) {
      return createErrorResult(
        'Browser extension not connected',
        'Please click the Browser button to connect.'
      )
    }

    try {
      const response = await this.client.call(toolName, args)
      const toolResult = toToolResult(response)
      return {
        error: toolResult.isError ? (toolResult.content[0]?.text || 'Tool call failed') : '',
        content: toolResult.content.map(normalizeContentItem),
      }
    } catch (err) {
      let errorMessage: string
      if (err instanceof TimeoutError) {
        errorMessage = `Tool call timed out after ${err.timeoutMs}ms`
      } else if (err instanceof ToolCallError) {
        errorMessage = err.toolError || 'Tool call failed'
      } else if (err instanceof NotConnectedError) {
        errorMessage = 'Browser extension disconnected during tool call'
      } else if (err instanceof ConnectionError) {
        errorMessage = err.message
      } else {
        errorMessage = err instanceof Error ? err.message : String(err)
      }
      return createErrorResult(errorMessage)
    }
  }

  async getConnectedServers(): Promise<string[]> {
    return this.connectionState === 'connected' ? [BROWSER_SERVER_NAME] : []
  }

  async refreshTools(): Promise<void> {
    await this.detectExtensionState()
  }

  async isHealthy(): Promise<boolean> {
    return this.connectionState === 'connected' && (this.client?.isConnected() ?? false)
  }

  getToolComponent(): ComponentType<MCPToolComponentProps> | null {
    const getState = this.getStateSnapshot
    const subscribeToState = this.subscribeToState
    const onConnect = () => this.connect()

    const isMobile =
      /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
      window.matchMedia('(max-width: 768px)').matches

    if (isMobile) return null

    return function WrappedBrowserToolButton(props: MCPToolComponentProps) {
      return BrowserToolButton({
        ...props,
        getState,
        subscribeToState,
        onConnect,
      } as BrowserToolComponentProps)
    }
  }

  async getDefaultDisabledTools(): Promise<string[]> {
    return getBrowserTools().map((tool) => `${tool.server}::${tool.name}`)
  }
}
