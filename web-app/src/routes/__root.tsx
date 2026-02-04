import { createRootRoute, Outlet } from '@tanstack/react-router'
// import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'

<<<<<<< HEAD
import LeftPanel from '@/containers/LeftPanel'
import DialogAppUpdater from '@/containers/dialogs/AppUpdater'
import BackendUpdater from '@/containers/dialogs/BackendUpdater'
import { Fragment } from 'react/jsx-runtime'
import { InterfaceProvider } from '@/providers/InterfaceProvider'
import { ThemeProvider } from '@/providers/ThemeProvider'
=======
import DialogAppUpdater from '@/containers/dialogs/AppUpdater'
import BackendUpdater from '@/containers/dialogs/BackendUpdater'
import { Fragment } from 'react/jsx-runtime'
import { ThemeProvider } from '@/providers/ThemeProvider'
import { InterfaceProvider } from '@/providers/InterfaceProvider'
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
import { KeyboardShortcutsProvider } from '@/providers/KeyboardShortcuts'
import { DataProvider } from '@/providers/DataProvider'
import { route } from '@/constants/routes'
import { ExtensionProvider } from '@/providers/ExtensionProvider'
import { ToasterProvider } from '@/providers/ToasterProvider'
import { useAnalytic } from '@/hooks/useAnalytic'
import { PromptAnalytic } from '@/containers/analytics/PromptAnalytic'
<<<<<<< HEAD
import { AnalyticProvider } from '@/providers/AnalyticProvider'
import { GoogleAnalyticsProvider } from '@/providers/GoogleAnalyticsProvider'
import { useLeftPanel } from '@/hooks/useLeftPanel'
import { cn } from '@/lib/utils'
import ToolApproval from '@/containers/dialogs/ToolApproval'
import { TranslationProvider } from '@/i18n/TranslationContext'
import OutOfContextPromiseModal from '@/containers/dialogs/OutOfContextDialog'
import LoadModelErrorDialog from '@/containers/dialogs/LoadModelErrorDialog'
import { useSmallScreen } from '@/hooks/useMediaQuery'
import AttachmentIngestionDialog from '@/containers/dialogs/AttachmentIngestionDialog'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable'
import { useCallback, useEffect } from 'react'
import GlobalError from '@/containers/GlobalError'
import { GlobalEventHandler } from '@/providers/GlobalEventHandler'
import ErrorDialog from '@/containers/dialogs/ErrorDialog'
import { ServiceHubProvider } from '@/providers/ServiceHubProvider'
import { AuthProvider } from '@/providers/AuthProvider'
import { PlatformFeatures } from '@/lib/platform/const'
import { PlatformFeature } from '@/lib/platform/types'
=======
import { useJanModelPrompt } from '@/hooks/useJanModelPrompt'
import { PromptJanModel } from '@/containers/PromptJanModel'
import { AnalyticProvider } from '@/providers/AnalyticProvider'
import { useLeftPanel } from '@/hooks/useLeftPanel'
import ToolApproval from '@/containers/dialogs/ToolApproval'
import { TranslationProvider } from '@/i18n/TranslationContext'
import OutOfContextPromiseModal from '@/containers/dialogs/OutOfContextDialog'
import AttachmentIngestionDialog from '@/containers/dialogs/AttachmentIngestionDialog'
import { useEffect } from 'react'
import GlobalError from '@/containers/GlobalError'
import { GlobalEventHandler } from '@/providers/GlobalEventHandler'
import { ServiceHubProvider } from '@/providers/ServiceHubProvider'
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { LeftSidebar } from '@/components/left-sidebar'

>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

export const Route = createRootRoute({
  component: RootLayout,
  errorComponent: ({ error }) => <GlobalError error={error} />,
})

const AppLayout = () => {
  const { productAnalyticPrompt } = useAnalytic()
<<<<<<< HEAD
  const {
    open: isLeftPanelOpen,
    setLeftPanel,
    size: leftPanelSize,
    setLeftPanelSize,
  } = useLeftPanel()
  const isSmallScreen = useSmallScreen()

  // Minimum width threshold for auto-close (10% of screen width)
  const MIN_PANEL_WIDTH_THRESHOLD = 14

  // Handle panel size changes
  const handlePanelLayout = useCallback(
    (sizes: number[]) => {
      if (sizes.length > 0) {
        const newSize = sizes[0]

        // Close panel if resized below minimum threshold
        if (newSize < MIN_PANEL_WIDTH_THRESHOLD) {
          setLeftPanel(false)
        } else {
          setLeftPanelSize(newSize)
        }
      }
    },
    [setLeftPanelSize, setLeftPanel]
  )

  // Prevent default drag and drop behavior globally
  useEffect(() => {
    const preventDefaults = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
    }

    const handleGlobalDrop = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()

      // Only prevent if the target is not within a chat input or other valid drop zone
      const target = e.target as Element
      const isValidDropZone =
        target?.closest('[data-drop-zone="true"]') ||
        target?.closest('.chat-input-drop-zone') ||
        target?.closest('[data-tauri-drag-region]')

      if (!isValidDropZone) {
        // Prevent the file from opening in the window
        return false
      }
    }

    // Add event listeners to prevent default drag/drop behavior
    window.addEventListener('dragenter', preventDefaults)
    window.addEventListener('dragover', preventDefaults)
    window.addEventListener('drop', handleGlobalDrop)

    return () => {
      window.removeEventListener('dragenter', preventDefaults)
      window.removeEventListener('dragover', preventDefaults)
      window.removeEventListener('drop', handleGlobalDrop)
    }
  }, [])

  return (
    <Fragment>
      <AnalyticProvider />
      {PlatformFeatures[PlatformFeature.GOOGLE_ANALYTICS] && (
        <GoogleAnalyticsProvider />
      )}
      <KeyboardShortcutsProvider />
      <main className="relative h-svh text-sm antialiased select-none bg-app">
        {/* Fake absolute panel top to enable window drag */}
        <div className="absolute w-full h-10 z-10" data-tauri-drag-region />
        <DialogAppUpdater />
        {PlatformFeatures[PlatformFeature.LOCAL_INFERENCE] && (
          <BackendUpdater />
        )}

        {/* Use ResizablePanelGroup only on larger screens */}
        {!isSmallScreen && isLeftPanelOpen ? (
          <ResizablePanelGroup
            direction="horizontal"
            className="h-full"
            onLayout={handlePanelLayout}
          >
            {/* Left Panel */}
            <ResizablePanel
              defaultSize={leftPanelSize}
              minSize={MIN_PANEL_WIDTH_THRESHOLD}
              maxSize={40}
              collapsible
            >
              <div className="h-full p-1">
                <LeftPanel />
              </div>
            </ResizablePanel>

            {/* Resize Handle */}
            <ResizableHandle withHandle />

            {/* Main Content Panel */}
            <ResizablePanel defaultSize={100 - leftPanelSize} minSize={60}>
              <div className="h-full p-1 pl-0">
                <div className="bg-main-view text-main-view-fg border border-main-view-fg/5 w-full h-full rounded-lg overflow-hidden">
                  <Outlet />
                </div>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <div className="flex h-full">
            {/* left content panel - only show if not logs route */}
            <LeftPanel />

            {/* Main content panel */}
            <div
              className={cn(
                'h-svh flex w-full md:p-1',
                isLeftPanelOpen && 'w-full md:w-[calc(100%-198px)]'
              )}
            >
              <div className="bg-main-view text-main-view-fg border border-main-view-fg/5 w-full md:rounded-lg overflow-hidden">
                <Outlet />
              </div>
            </div>
          </div>
        )}
      </main>
      {PlatformFeatures[PlatformFeature.ANALYTICS] && productAnalyticPrompt && (
        <PromptAnalytic />
      )}
    </Fragment>
=======
  const { showJanModelPrompt } = useJanModelPrompt()
  const {
    open: isLeftPanelOpen,
    setLeftPanel,
    width: sidebarWidth,
    setLeftPanelWidth,
  } = useLeftPanel()

  return (
    <div className='bg-neutral-50 dark:bg-background size-full'>
      <SidebarProvider
        open={isLeftPanelOpen}
        onOpenChange={setLeftPanel}
        defaultWidth={sidebarWidth}
        onWidthChange={setLeftPanelWidth}
      >
        <AnalyticProvider />
        <KeyboardShortcutsProvider />
        {/* Fake absolute panel top to enable window drag */}
        {IS_MACOS &&
          <div className="fixed w-full h-2 z-20 top-0" data-tauri-drag-region />
        }
        <DialogAppUpdater />
        <BackendUpdater />
        <LeftSidebar />
        <SidebarInset >
          <div className='bg-neutral-50 dark:bg-background size-full'>
            <Outlet />
          </div>
        </SidebarInset>

        {productAnalyticPrompt && <PromptAnalytic />}
        {showJanModelPrompt && <PromptJanModel />}

      </SidebarProvider>
    </div>
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
  )
}

const LogsLayout = () => {
  return (
    <Fragment>
      <main className="relative h-svh text-sm antialiased select-text bg-app">
        <div className="flex h-full">
          {/* Main content panel */}
          <div className="h-full flex w-full">
<<<<<<< HEAD
            <div className="bg-main-view text-main-view-fg border border-main-view-fg/5 w-full overflow-hidden">
=======
            <div className="bg-background text-foreground border w-full overflow-hidden">
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
              <Outlet />
            </div>
          </div>
        </div>
      </main>
    </Fragment>
  )
}

function RootLayout() {
  const getInitialLayoutType = () => {
    const pathname = window.location.pathname
    return (
      pathname === route.localApiServerlogs ||
      pathname === route.systemMonitor ||
      pathname === route.appLogs
    )
  }

  useEffect(() => {
    // Wait for the UI to be fully rendered before hiding the loader
    const hideLoader = () => {
      requestAnimationFrame(() => {
        // Hide the HTML loader
        document.body.classList.add('loaded')

        // Remove the HTML loader element after transition
        const loader = document.getElementById('initial-loader')
        if (loader) {
          setTimeout(() => {
            loader.remove()
          }, 300)
        }
      })
    }

    // Give providers time to initialize and paint
    const timer = setTimeout(hideLoader, 200)

    return () => clearTimeout(timer)
  }, [])

  const IS_LOGS_ROUTE = getInitialLayoutType()

  return (
    <Fragment>
      <ServiceHubProvider>
        <ThemeProvider />
        <InterfaceProvider />
        <ToasterProvider />
        <TranslationProvider>
          <ExtensionProvider>
<<<<<<< HEAD
            <AuthProvider>
              <DataProvider />
              <GlobalEventHandler />
              {IS_LOGS_ROUTE ? <LogsLayout /> : <AppLayout />}
            </AuthProvider>
          </ExtensionProvider>
          {/* {isLocalAPIServerLogsRoute ? <LogsLayout /> : <AppLayout />} */}
          {/* <TanStackRouterDevtools position="bottom-right" /> */}
          <ToolApproval />
          <LoadModelErrorDialog />
          <ErrorDialog />
=======
            <DataProvider />
            <GlobalEventHandler />
            {IS_LOGS_ROUTE ? <LogsLayout /> : <AppLayout />}
          </ExtensionProvider>
          {/* <TanStackRouterDevtools position="bottom-right" /> */}
          <ToolApproval />
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
          <AttachmentIngestionDialog />
          <OutOfContextPromiseModal />
        </TranslationProvider>
      </ServiceHubProvider>
    </Fragment>
  )
}
