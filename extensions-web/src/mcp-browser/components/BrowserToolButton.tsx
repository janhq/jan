import { useMemo, useCallback, useState, useSyncExternalStore } from 'react'
import { IconBrowser, IconAlertCircle, IconDownload, IconBrowserOff } from '@tabler/icons-react'
import type { MCPToolComponentProps } from '@janhq/core'
import { getBrowserToolNames } from '../tools'
import type { BrowserExtensionState } from '../index'

// Chrome Web Store URL injected at build time via vite.config.ts
declare const CHROME_STORE_URL: string

/**
 * Extended props for BrowserToolButton
 */
export interface BrowserToolButtonProps extends MCPToolComponentProps {
  getState: () => BrowserExtensionState
  subscribeToState: (callback: () => void) => () => void
  onConnect: () => void
}

export const BrowserToolButton = ({
  tools,
  isToolEnabled,
  onToolToggle,
  getState,
  subscribeToState,
  onConnect,
}: BrowserToolButtonProps) => {
  // Subscribe to extension state using useSyncExternalStore
  const { connectionState, isExtensionInstalled, isBrowserSupported } = useSyncExternalStore(subscribeToState, getState)

  const [showPopup, setShowPopup] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Get browser tool names
  const browserToolNames = useMemo(() => getBrowserToolNames(), [])

  // Filter to only browser tools
  const browserTools = useMemo(
    () => tools.filter((tool) => browserToolNames.includes(tool.name)),
    [tools, browserToolNames]
  )

  // Check if all browser tools are enabled
  const isEnabled = useMemo(() => {
    if (browserTools.length === 0) return false
    return browserTools.every((tool) => isToolEnabled(tool.name))
  }, [browserTools, isToolEnabled])

  // Check if connected
  const isConnected = connectionState === 'connected'

  // Toggle all browser tools
  const handleToggleBrowserTools = useCallback(() => {
    const newState = !isEnabled
    browserTools.forEach((tool) => {
      onToolToggle(tool.name, newState)
    })
  }, [isEnabled, browserTools, onToolToggle])

  // Handle connection
  const handleConnect = useCallback(() => {
    setIsConnecting(true)
    setError(null)
    try {
      onConnect()
      // After successful connection, enable all browser tools
      browserTools.forEach((tool) => {
        onToolToggle(tool.name, true)
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect')
      setShowPopup(true)
    } finally {
      setIsConnecting(false)
    }
  }, [onConnect, browserTools, onToolToggle])

  // Handle button click
  const handleClick = useCallback(() => {
    setError(null)

    if (!isBrowserSupported) {
      // Show unsupported browser popup
      setShowPopup(true)
    } else if (isConnected) {
      // Toggle browser tools on/off
      handleToggleBrowserTools()
    } else if (!isExtensionInstalled) {
      // Show install popup
      setShowPopup(true)
    } else {
      // Try to connect
      handleConnect()
    }
  }, [isBrowserSupported, isConnected, isExtensionInstalled, handleToggleBrowserTools, handleConnect])

  const handleInstallClick = useCallback(() => {
    window.open(CHROME_STORE_URL, '_blank')
    setShowPopup(false)
  }, [])

  const handlePopupClose = useCallback(() => {
    setShowPopup(false)
    setError(null)
  }, [])

  // Button styling
  const getButtonStyle = () => {
    if (isConnected && isEnabled) {
      return 'bg-accent/20 text-accent'
    }
    if (isConnecting) {
      return 'bg-main-view-fg/10 text-main-view-fg/50'
    }
    return 'bg-transparent text-main-view-fg/70 hover:bg-main-view-fg/5'
  }

  // Status indicator
  const getStatusIndicator = () => {
    if (!isBrowserSupported) {
      return <IconBrowserOff size={12} className="ml-1 text-main-view-fg/30" />
    }
    if (isConnecting) {
      return (
        <span className="animate-spin h-3 w-3 border-2 border-current border-t-transparent rounded-full ml-1" />
      )
    }
    if (!isExtensionInstalled) {
      return <IconDownload size={12} className="ml-1 text-main-view-fg/50" />
    }
    if (connectionState === 'error') {
      return <IconAlertCircle size={12} className="ml-1 text-orange-500" />
    }
    if (isConnected) {
      return <span className="ml-1 w-2 h-2 rounded-full bg-green-500" />
    }
    return <span className="ml-1 w-2 h-2 rounded-full bg-main-view-fg/30" />
  }

  // Tooltip text
  const getTooltip = () => {
    if (!isBrowserSupported) return 'Browser not supported (Chrome/Edge required)'
    if (isConnecting) return 'Connecting...'
    if (!isExtensionInstalled) return 'Install Browser Extension'
    if (connectionState === 'error') return 'Connection Error - Click to retry'
    if (isConnected) {
      return isEnabled ? 'Disable Browser Control' : 'Enable Browser Control'
    }
    return 'Connect Browser Extension'
  }

  return (
    <div className="relative">
      <button
        onClick={handleClick}
        disabled={isConnecting}
        className={`h-7 px-2 py-1 flex items-center justify-center rounded-md transition-all duration-200 ease-in-out gap-1 cursor-pointer ml-0.5 border-0 ${getButtonStyle()}`}
        title={getTooltip()}
      >
        <IconBrowser
          size={16}
          className={isConnected && isEnabled ? 'text-accent' : 'text-main-view-fg/70'}
        />
        <span className={`text-sm font-medium ${isConnected && isEnabled ? 'text-accent' : ''}`}>
          Browser
        </span>
        {getStatusIndicator()}
      </button>

      {/* Popup for install/error messages */}
      {showPopup && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={handlePopupClose} />

          {/* Popup */}
          <div className="absolute bottom-full left-0 mb-2 z-50 w-72 bg-main-view border border-main-view-fg/10 rounded-lg shadow-lg p-4">
            {!isBrowserSupported ? (
              <>
                <div className="flex items-start gap-3 mb-3">
                  <IconBrowserOff size={24} className="text-main-view-fg/50 flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-medium text-main-view-fg mb-1">
                      Browser Not Supported
                    </h3>
                    <p className="text-sm text-main-view-fg/70">
                      Browser automation requires Chrome, Edge, Brave, or another Chromium-based browser.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handlePopupClose}
                    className="flex-1 bg-main-view-fg/10 text-main-view-fg px-3 py-2 rounded-md text-sm font-medium hover:bg-main-view-fg/20 transition-colors"
                  >
                    Got it
                  </button>
                </div>
              </>
            ) : !isExtensionInstalled ? (
              <>
                <div className="flex items-start gap-3 mb-3">
                  <IconBrowser size={24} className="text-accent flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-medium text-main-view-fg mb-1">
                      Browser Extension Required
                    </h3>
                    <p className="text-sm text-main-view-fg/70">
                      Install the Jan Browser extension to enable browser automation features.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleInstallClick}
                    className="flex-1 bg-accent text-accent-fg px-3 py-2 rounded-md text-sm font-medium hover:bg-accent/90 transition-colors"
                  >
                    Install Extension
                  </button>
                  <button
                    onClick={handlePopupClose}
                    className="px-3 py-2 rounded-md text-sm text-main-view-fg/70 hover:bg-main-view-fg/10 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : error ? (
              <>
                <div className="flex items-start gap-3 mb-3">
                  <IconAlertCircle size={24} className="text-orange-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-medium text-main-view-fg mb-1">Connection Error</h3>
                    <p className="text-sm text-main-view-fg/70">{error}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handlePopupClose}
                    className="flex-1 bg-main-view-fg/10 text-main-view-fg px-3 py-2 rounded-md text-sm font-medium hover:bg-main-view-fg/20 transition-colors"
                  >
                    Got it
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
