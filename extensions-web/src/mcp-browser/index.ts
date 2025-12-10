/**
 * MCP Browser Extension
 * Provides browser automation tools via the jan-browser Chrome extension
 * Uses @janhq/mcp-web-client for direct chrome.runtime communication
 */

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

// Extension ID injected at build time via vite.config.ts
declare const BROWSER_EXTENSION_ID: string

// LocalStorage key for settings (matches web-app's useGeneralSetting)
const SETTINGS_STORAGE_KEY = 'setting-general'

/**
 * Get browser extension ID from localStorage settings or fallback to build-time value
 */
function getExtensionIdFromSettings(): string {
  try {
    if (typeof localStorage === 'undefined') {
      return BROWSER_EXTENSION_ID
    }
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      // Check for non-empty string
      if (parsed?.state?.browserExtensionId && typeof parsed.state.browserExtensionId === 'string' && parsed.state.browserExtensionId.trim()) {
        return parsed.state.browserExtensionId.trim()
      }
    }
  } catch {
    // Ignore parsing errors
  }
  return BROWSER_EXTENSION_ID
}

/**
 * State snapshot for UI components
 */
export interface BrowserExtensionState {
  connectionState: ConnectionState
  isExtensionInstalled: boolean
  isBrowserSupported: boolean
}

/**
 * Extended props for BrowserToolButton that includes extension state
 */
export interface BrowserToolComponentProps extends MCPToolComponentProps {
  /** Get current state snapshot */
  getState: () => BrowserExtensionState
  /** Subscribe to state changes, returns unsubscribe function */
  subscribeToState: (callback: () => void) => () => void
  onConnect: () => void
}

export default class MCPBrowserExtension extends MCPExtension {
  private client: McpWebClient | null = null
  private connectionState: ConnectionState = 'disconnected'
  private extensionId: string
  private detectionResult: DetectionResult | null = null
  private stateListeners: Set<() => void> = new Set()
  private pollingInterval: ReturnType<typeof setInterval> | null = null
  private readonly POLL_INTERVAL = 10000 // 10 seconds
  // Cached state snapshot for useSyncExternalStore
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
    // Get extension ID from settings (localStorage) or use build-time/default value
    this.extensionId = getExtensionIdFromSettings()
  }

  async onLoad(): Promise<void> {
    // Skip if not Chrome browser
    if (!isChromeBrowser()) {
      console.log('Browser not supported for MCP browser extension')
      return
    }

    // Initial detection
    await this.detectExtensionState()

    // Auto-connect if extension is available
    if (this.detectionResult?.isExtensionAvailable) {
      try {
        this.connect()
      } catch (error) {
        console.warn('Failed to auto-connect to browser extension:', error)
      }
    }

    // Start polling if not connected
    if (this.connectionState !== 'connected') {
      this.startPolling()
    }
  }

  async onUnload(): Promise<void> {
    this.stopPolling()
    this.disconnect()
    this.stateListeners.clear()
  }

  /**
   * Detect extension state (installed/available)
   */
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

  /**
   * Start polling for extension state (when disconnected)
   */
  private startPolling(): void {
    if (this.pollingInterval) return

    this.pollingInterval = setInterval(async () => {
      const prevInstalled = this.detectionResult?.isExtensionAvailable ?? false
      await this.detectExtensionState()
      const nowInstalled = this.detectionResult?.isExtensionAvailable ?? false

      // Auto-connect if extension becomes available
      if (!prevInstalled && nowInstalled && !this.client?.isConnected()) {
        try {
          this.connect()
        } catch (e) {
          console.warn('Auto-connect failed:', e)
        }
      }
    }, this.POLL_INTERVAL)
  }

  /**
   * Stop polling
   */
  private stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval)
      this.pollingInterval = null
    }
  }

  /**
   * Get current connection state
   */
  getConnectionState(): ConnectionState {
    return this.connectionState
  }

  /**
   * Check if browser is supported
   */
  isBrowserSupported(): boolean {
    return isChromeBrowser()
  }

  /**
   * Connect to the browser extension
   */
  connect(): void {
    if (this.client?.isConnected()) {
      return
    }

    if (!this.detectionResult?.isExtensionAvailable) {
      throw new ConnectionError('Browser extension is not installed')
    }

    // Clean up old client
    if (this.client) {
      this.client.disconnect()
      this.client = null
    }

    // Create new client
    this.client = new McpWebClient({
      extensionId: this.extensionId,
      timeout: 30000,
    })

    // Set up event handlers
    this.client.on('connect', () => {
      this.setConnectionState('connected')
    })

    this.client.on('disconnect', async () => {
      this.setConnectionState('disconnected')
      // Immediately re-detect to check if extension still exists
      await this.detectExtensionState()
    })

    this.client.on('error', (error: Error) => {
      console.error('Browser extension error:', error)
      this.setConnectionState('error')
    })

    this.client.on('stateChange', (state: ConnectionState) => {
      this.setConnectionState(state)
    })

    // Connect (synchronous)
    this.client.connect()
  }

  /**
   * Disconnect from the browser extension
   */
  disconnect(): void {
    if (this.client) {
      this.client.disconnect()
      this.client = null
    }
    this.setConnectionState('disconnected')
  }

  /**
   * Set connection state and manage polling
   */
  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState !== state) {
      const wasConnected = this.connectionState === 'connected'
      this.connectionState = state

      // Manage polling based on connection state
      if (state === 'connected') {
        this.stopPolling()
        // Emit event to trigger tools refresh when newly connected
        if (!wasConnected && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('mcp-browser-connected'))
        }
      } else {
        this.startPolling()
      }

      this.notifyStateChange()
    }
  }

  /**
   * Get state snapshot for useSyncExternalStore
   * Returns cached snapshot if values unchanged
   */
  getStateSnapshot = (): BrowserExtensionState => {
    const isExtensionInstalled = this.detectionResult?.isExtensionAvailable ?? false
    const isBrowserSupported = this.isBrowserSupported()

    // Return cached if unchanged
    if (
      this.cachedSnapshot &&
      this.cachedSnapshot.connectionState === this.connectionState &&
      this.cachedSnapshot.isExtensionInstalled === isExtensionInstalled &&
      this.cachedSnapshot.isBrowserSupported === isBrowserSupported
    ) {
      return this.cachedSnapshot
    }

    // Create new snapshot
    this.cachedSnapshot = {
      connectionState: this.connectionState,
      isExtensionInstalled,
      isBrowserSupported,
    }
    return this.cachedSnapshot
  }

  /**
   * Subscribe to state changes (for useSyncExternalStore)
   */
  subscribeToState = (callback: () => void): (() => void) => {
    this.stateListeners.add(callback)
    return () => {
      this.stateListeners.delete(callback)
    }
  }

  /**
   * Notify all state listeners
   */
  private notifyStateChange(): void {
    this.stateListeners.forEach((callback) => {
      try {
        callback()
      } catch (error) {
        console.error('Error in state listener:', error)
      }
    })
  }

  // MCPExtension interface implementation

  async getTools(): Promise<MCPTool[]> {
    if (this.connectionState !== 'connected') {
      return []
    }
    return getBrowserTools()
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
        'Browser extension is not connected. Please click the Browser button to connect.'
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

  async getConnectedServers(): Promise<string[]> {
    if (this.connectionState === 'connected') {
      return [BROWSER_SERVER_NAME]
    }
    return []
  }

  async refreshTools(): Promise<void> {
    await this.detectExtensionState()
  }

  async isHealthy(): Promise<boolean> {
    return this.connectionState === 'connected' && (this.client?.isConnected() ?? false)
  }

  /**
   * Get custom UI component for browser tools
   * Always returns the component - it handles unsupported browsers internally
   */
  getToolComponent(): ComponentType<MCPToolComponentProps> | null {
    // Bind methods to maintain stable references
    const getState = this.getStateSnapshot
    const subscribeToState = this.subscribeToState
    const onConnect = () => this.connect()

    return function WrappedBrowserToolButton(props: MCPToolComponentProps) {
      return BrowserToolButton({
        ...props,
        getState,
        subscribeToState,
        onConnect,
      } as BrowserToolComponentProps)
    }
  }

  /**
   * All browser tools are disabled by default
   */
  async getDefaultDisabledTools(): Promise<string[]> {
    return getBrowserTools().map((tool) => `${tool.server}::${tool.name}`)
  }
}
