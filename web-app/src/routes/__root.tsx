import { createRootRoute, Outlet, useRouterState } from '@tanstack/react-router'
// import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'

import LeftPanel from '@/containers/LeftPanel'
import DialogAppUpdater from '@/containers/dialogs/AppUpdater'
import { Fragment } from 'react/jsx-runtime'
import { AppearanceProvider } from '@/providers/AppearanceProvider'
import { ThemeProvider } from '@/providers/ThemeProvider'
import { KeyboardShortcutsProvider } from '@/providers/KeyboardShortcuts'
import { DataProvider } from '@/providers/DataProvider'
import { route } from '@/constants/routes'
import { ExtensionProvider } from '@/providers/ExtensionProvider'
import { ToasterProvider } from '@/providers/ToasterProvider'
import { useAnalytic } from '@/hooks/useAnalytic'
import { PromptAnalytic } from '@/containers/analytics/PromptAnalytic'
import { AnalyticProvider } from '@/providers/AnalyticProvider'
import { useLeftPanel } from '@/hooks/useLeftPanel'
import { cn } from '@/lib/utils'
import ToolApproval from '@/containers/dialogs/ToolApproval'
import { TranslationProvider } from '@/i18n/TranslationContext'
import OutOfContextPromiseModal from '@/containers/dialogs/OutOfContextDialog'
import LoadModelErrorDialog from '@/containers/dialogs/LoadModelErrorDialog'
import { useSmallScreen } from '@/hooks/useMediaQuery'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable'
import { useCallback } from 'react'
import GlobalError from '@/containers/GlobalError'
import { GlobalEventHandler } from '@/providers/GlobalEventHandler'

export const Route = createRootRoute({
  component: RootLayout,
  errorComponent: ({ error }) => <GlobalError error={error} />,
})

const AppLayout = () => {
  const { productAnalyticPrompt } = useAnalytic()
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

  return (
    <Fragment>
      <AnalyticProvider />
      <KeyboardShortcutsProvider />
      <main className="relative h-svh text-sm antialiased select-none bg-app">
        {/* Fake absolute panel top to enable window drag */}
        <div className="absolute w-full h-10 z-10" data-tauri-drag-region />
        <DialogAppUpdater />

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
                'h-full flex w-full p-1 ',
                isLeftPanelOpen && 'w-full md:w-[calc(100%-198px)]'
              )}
            >
              <div className="bg-main-view text-main-view-fg border border-main-view-fg/5 w-full rounded-lg overflow-hidden">
                <Outlet />
              </div>
            </div>
          </div>
        )}
      </main>
      {productAnalyticPrompt && <PromptAnalytic />}
    </Fragment>
  )
}

const LogsLayout = () => {
  return (
    <Fragment>
      <main className="relative h-svh text-sm antialiased select-text bg-app">
        <div className="flex h-full">
          {/* Main content panel */}
          <div className="h-full flex w-full">
            <div className="bg-main-view text-main-view-fg border border-main-view-fg/5 w-full overflow-hidden">
              <Outlet />
            </div>
          </div>
        </div>
      </main>
    </Fragment>
  )
}

function RootLayout() {
  const router = useRouterState()

  const isLocalAPIServerLogsRoute =
    router.location.pathname === route.localApiServerlogs ||
    router.location.pathname === route.systemMonitor ||
    router.location.pathname === route.appLogs

  return (
    <Fragment>
      <ThemeProvider />
      <AppearanceProvider />
      <ToasterProvider />
      <TranslationProvider>
        <ExtensionProvider>
          <DataProvider />
          <GlobalEventHandler />
        </ExtensionProvider>
        {isLocalAPIServerLogsRoute ? <LogsLayout /> : <AppLayout />}
        {/* <TanStackRouterDevtools position="bottom-right" /> */}
        <ToolApproval />
        <LoadModelErrorDialog />
        <OutOfContextPromiseModal />
      </TranslationProvider>
    </Fragment>
  )
}
