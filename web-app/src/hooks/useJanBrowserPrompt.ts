import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { localStorageKey } from '@/constants/localStorage'
import { useMCPServers } from './useMCPServers'
import { useServiceHub } from './useServiceHub'

export const useJanBrowserPrompt = () => {
  const [showPrompt, setShowPrompt] = useState(false)
  const { mcpServers } = useMCPServers()
  const serviceHub = useServiceHub()

  const handleExtensionInstalled = useCallback(async () => {
    // Mark as installed
    localStorage.setItem(
      localStorageKey.janBrowserExtensionInstalled,
      'true'
    )

    // Enable Jan Browser MCP
    const janBrowserKey = 'Jan Browser Extension (Experimental)'
    const janBrowserConfig = mcpServers[janBrowserKey]

    if (janBrowserConfig) {
      try {
        // Enable Jan Browser
        await serviceHub.mcp().activateMCPServer(janBrowserKey, {
          ...janBrowserConfig,
          active: true,
        })

        // Disable default browsermcp if it exists and is active
        const browsermcpKey = 'browsermcp'
        if (mcpServers[browsermcpKey]?.active) {
          await serviceHub.mcp().deactivateMCPServer(browsermcpKey)
        }

        // Show success toast
        toast.success(
          'Jan Browser Extension is now connected! You can now use browser tools in your conversations.',
          {
            duration: 5000,
          }
        )
      } catch (error) {
        console.error('Error activating Jan Browser MCP:', error)
        toast.error('Failed to enable Jan Browser Extension. Please try enabling it manually in MCP settings.')
      }
    }
  }, [mcpServers, serviceHub])

  const startPollingForExtension = useCallback(() => {
    // Poll every 5 seconds to check if extension is connected
    const pollInterval = setInterval(async () => {
      try {
        const connectedServers = await serviceHub.mcp().getConnectedServers()

        // Check if Jan Browser is connected
        if (
          connectedServers.includes('Jan Browser Extension (Experimental)')
        ) {
          clearInterval(pollInterval)
          await handleExtensionInstalled()
        }
      } catch (error) {
        console.error('Error checking connected servers:', error)
      }
    }, 5000)

    // Stop polling after 5 minutes
    setTimeout(() => clearInterval(pollInterval), 5 * 60 * 1000)
  }, [handleExtensionInstalled, serviceHub])

  const handleDismiss = useCallback(() => {
    localStorage.setItem(localStorageKey.janBrowserPromptShown, 'true')
  }, [])

  const handleInstallClick = useCallback(() => {
    // Open Chrome Web Store or installation guide
    const extensionUrl =
      'https://github.com/menloresearch/jan-browser-extension'
    window.open(extensionUrl, '_blank')

    // Mark as shown
    localStorage.setItem(localStorageKey.janBrowserPromptShown, 'true')

    // Show follow-up toast
    toast.success(
      "After installing the extension, come back here and we'll enable it automatically!",
      {
        duration: 5000,
      }
    )

    // Start polling for extension installation
    startPollingForExtension()
  }, [startPollingForExtension])

  const showJanBrowserPrompt = useCallback(() => {
    toast.info(
      'Enhance your AI with browser capabilities! Install Jan Browser Extension to enable web browsing, search, and automation tools.',
      {
        duration: 10000,
        action: {
          label: 'Install Extension',
          onClick: handleInstallClick,
        },
        cancel: {
          label: 'Maybe Later',
          onClick: handleDismiss,
        },
      }
    )
  }, [handleInstallClick, handleDismiss])

  useEffect(() => {
    // Only show on first launch
    const promptShown = localStorage.getItem(
      localStorageKey.janBrowserPromptShown
    )
    const setupCompleted = localStorage.getItem(
      localStorageKey.setupCompleted
    )

    // Show prompt if:
    // 1. Setup is completed (not first-time setup screen)
    // 2. Prompt has not been shown before
    if (setupCompleted === 'true' && !promptShown) {
      setTimeout(() => {
        setShowPrompt(true)
        showJanBrowserPrompt()
      }, 2000) // Delay 2 seconds after app loads
    }
  }, [showJanBrowserPrompt])

  return { showPrompt }
}
