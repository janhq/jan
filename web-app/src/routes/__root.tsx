import { createRootRoute, Outlet } from '@tanstack/react-router'
// import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'

import DialogAppUpdater from '@/containers/dialogs/AppUpdater'
import BackendUpdater from '@/containers/dialogs/BackendUpdater'
import { Fragment } from 'react/jsx-runtime'
import { ThemeProvider } from '@/providers/ThemeProvider'
import { InterfaceProvider } from '@/providers/InterfaceProvider'
import { KeyboardShortcutsProvider } from '@/providers/KeyboardShortcuts'
import { DataProvider } from '@/providers/DataProvider'
import { route } from '@/constants/routes'
import { ExtensionProvider } from '@/providers/ExtensionProvider'
import { ToasterProvider } from '@/providers/ToasterProvider'
import { useAnalytic } from '@/hooks/useAnalytic'
import { PromptAnalytic } from '@/containers/analytics/PromptAnalytic'
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
import { GatewayMessageProcessor } from '@/containers/Gateway'
import { ServiceHubProvider } from '@/providers/ServiceHubProvider'
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { LeftSidebar } from '@/components/left-sidebar'


export const Route = createRootRoute({
  component: RootLayout,
  errorComponent: ({ error }) => <GlobalError error={error} />,
})

const AppLayout = () => {
  const { productAnalyticPrompt } = useAnalytic()
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
  )
}

const LogsLayout = () => {
  return (
    <Fragment>
      <main className="relative h-svh text-sm antialiased select-text bg-app">
        <div className="flex h-full">
          {/* Main content panel */}
          <div className="h-full flex w-full">
            <div className="bg-background text-foreground border w-full overflow-hidden">
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
            <DataProvider />
            <GlobalEventHandler />
            <GatewayMessageProcessor />
            {IS_LOGS_ROUTE ? <LogsLayout /> : <AppLayout />}
          </ExtensionProvider>
          {/* <TanStackRouterDevtools position="bottom-right" /> */}
          <ToolApproval />
          <AttachmentIngestionDialog />
          <OutOfContextPromiseModal />
        </TranslationProvider>
      </ServiceHubProvider>
    </Fragment>
  )
}
