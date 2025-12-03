import { useState, useCallback, useRef } from 'react'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useMCPServers } from '@/hooks/useMCPServers'
import { toast } from 'sonner'
import type { JanBrowserExtensionDialogState } from '@/containers/dialogs/JanBrowserExtensionDialog'

const JAN_BROWSER_MCP_NAME = 'Jan Browser MCP'

// Timeout and polling configuration
const PING_TIMEOUT_MS = 6000 // Backend ping takes up to 3s
const POLL_INTERVAL_MS = 500
const SERVER_START_DELAY_MS = 1000
const SUCCESS_CLOSE_DELAY_MS = 1500

export function useJanBrowserExtension() {
  const serviceHub = useServiceHub()
  const { mcpServers, editServer, syncServers } = useMCPServers()

  const [dialogState, setDialogState] = useState<JanBrowserExtensionDialogState>('closed')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)

  const cancelledRef = useRef(false)
  const cancelDeactivationPromiseRef = useRef<Promise<void> | null>(null)
  const operationInProgressRef = useRef(false)

  const janBrowserConfig = mcpServers[JAN_BROWSER_MCP_NAME]
  const hasConfig = !!janBrowserConfig
  const isActive = janBrowserConfig?.active ?? false

  /**
   * Check if the browser extension is connected (single check)
   */
  const checkExtensionConnection = useCallback(async (): Promise<boolean> => {
    try {
      return await serviceHub.mcp().checkJanBrowserExtensionConnected()
    } catch (error) {
      console.error('Error checking extension connection:', error)
      return false
    }
  }, [serviceHub])

  /**
   * Poll for extension connection with timeout
   */
  const waitForExtensionConnection = useCallback(async (
    maxWaitMs: number = PING_TIMEOUT_MS,
    pollIntervalMs: number = POLL_INTERVAL_MS
  ): Promise<boolean> => {
    const startTime = Date.now()
    while (Date.now() - startTime < maxWaitMs) {
      if (cancelledRef.current) {
        return false
      }
      const connected = await checkExtensionConnection()
      if (connected) {
        return true
      }
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
    }
    return false
  }, [checkExtensionConnection])

  /**
   * Handle successful connection - show success state and auto-close
   */
  const handleConnectionSuccess = useCallback(() => {
    setDialogState('connected')
    toast.success('Jan Browser MCP enabled')
    setTimeout(() => {
      setDialogOpen(false)
      setDialogState('closed')
    }, SUCCESS_CLOSE_DELAY_MS)
  }, [])

  /**
   * Handle retry connection (called from dialog's "I've Installed It" or "Check Again" button)
   */
  const handleRetryConnection = useCallback(async () => {
    setDialogState('checking')

    const connected = await waitForExtensionConnection(PING_TIMEOUT_MS, POLL_INTERVAL_MS)

    if (connected) {
      handleConnectionSuccess()
    } else {
      // Still not connected, show waiting state
      setDialogState('waiting_connection')
    }
  }, [waitForExtensionConnection, handleConnectionSuccess])

  /**
   * Handle continue anyway (user wants to proceed without extension)
   */
  const handleContinueAnyway = useCallback(() => {
    setDialogOpen(false)
    setDialogState('closed')
    toast.info('Jan Browser MCP is active', {
      description: 'Connect the browser extension to use browser tools',
    })
  }, [])

  /**
   * Handle cancel async
   */
  const handleCancel = useCallback(() => {
    cancelledRef.current = true
    setDialogOpen(false)
    setDialogState('closed')
    setIsLoading(false)

    if (janBrowserConfig) {
      setIsCancelling(true)

      editServer(JAN_BROWSER_MCP_NAME, {
        ...janBrowserConfig,
        active: false,
      })

      const deactivationPromise = Promise.all([
        serviceHub.mcp().deactivateMCPServer(JAN_BROWSER_MCP_NAME),
        syncServers(),
      ])
        .then(() => {})
        .catch((error) => {
          console.error('Error deactivating Jan Browser MCP on cancel:', error)
        })
        .finally(() => {
          cancelDeactivationPromiseRef.current = null
          setIsCancelling(false)
        })

      cancelDeactivationPromiseRef.current = deactivationPromise
    }
  }, [janBrowserConfig, serviceHub, editServer, syncServers])

  /**
   * Toggle the Jan Browser MCP (called when clicking the browser icon)
   */
  const toggleBrowser = useCallback(async () => {
    // Atomic check - refs update synchronously, prevents race conditions
    if (operationInProgressRef.current) return
    operationInProgressRef.current = true

    try {
      if (!janBrowserConfig) {
        toast.error('Jan Browser MCP not found', {
          description: 'Please check your MCP server configuration',
        })
        return
      }

      if (cancelDeactivationPromiseRef.current) {
        await cancelDeactivationPromiseRef.current
      }

      const newActiveState = !isActive
      cancelledRef.current = false

      setIsLoading(true)
      if (newActiveState) {
        // Activate the server
        await serviceHub.mcp().activateMCPServer(JAN_BROWSER_MCP_NAME, {
          ...janBrowserConfig,
          active: true,
        })

        // Check if cancelled during activation
        if (cancelledRef.current) return

        editServer(JAN_BROWSER_MCP_NAME, {
          ...janBrowserConfig,
          active: true,
        })
        await syncServers()

        // Show dialog and check for extension connection
        setDialogOpen(true)
        setDialogState('checking')

        // Wait for server to fully start
        await new Promise(resolve => setTimeout(resolve, SERVER_START_DELAY_MS))

        const connected = await waitForExtensionConnection(PING_TIMEOUT_MS, POLL_INTERVAL_MS)

        // Check if cancelled during connection check
        if (cancelledRef.current) return

        if (connected) {
          handleConnectionSuccess()
        } else {
          // Extension not connected - show install/connect prompt
          setDialogState('not_installed')
        }
      } else {
        // Deactivate the server
        await serviceHub.mcp().deactivateMCPServer(JAN_BROWSER_MCP_NAME)
        toast.success('Jan Browser MCP disabled')

        editServer(JAN_BROWSER_MCP_NAME, {
          ...janBrowserConfig,
          active: false,
        })
        await syncServers()
      }
    } catch (error) {
      // Don't show error if cancelled
      if (cancelledRef.current) return

      toast.error('Failed to toggle Jan Browser MCP', {
        description: error instanceof Error ? error.message : String(error),
      })
      console.error('Error toggling Jan Browser MCP:', error)
      setDialogOpen(false)
      setDialogState('closed')
    } finally {
      if (!cancelledRef.current) {
        setIsLoading(false)
      }
      // Always release the mutex
      operationInProgressRef.current = false
    }
  }, [
    janBrowserConfig,
    isActive,
    serviceHub,
    editServer,
    syncServers,
    waitForExtensionConnection,
    handleConnectionSuccess,
  ])

  return {
    // State
    hasConfig,
    isActive,
    isLoading: isLoading || isCancelling,
    dialogOpen,
    dialogState,

    // Actions
    toggleBrowser,
    handleRetryConnection,
    handleContinueAnyway,
    handleCancel,
    setDialogOpen,
  }
}
