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
import { useIsOnboarding } from '@/hooks/useIsOnboarding'
import { PromptAnalytic } from '@/containers/analytics/PromptAnalytic'
import { AnalyticProvider } from '@/providers/AnalyticProvider'
import { useLeftPanel } from '@/hooks/useLeftPanel'
import { TranslationProvider } from '@/i18n/TranslationContext'
import OutOfContextPromiseModal from '@/containers/dialogs/OutOfContextDialog'
import AttachmentIngestionDialog from '@/containers/dialogs/AttachmentIngestionDialog'
import GlobalError from '@/containers/GlobalError'
import { GlobalEventHandler } from '@/providers/GlobalEventHandler'
import { DownloadEventListener } from '@/providers/DownloadEventListener'
import { ServiceHubProvider } from '@/providers/ServiceHubProvider'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { LeftSidebar } from '@/components/left-sidebar'
import { WindowControls } from '@/components/WindowControls'
import { WindowResizeGrips } from '@/components/WindowResizeGrips'
import ErrorDialog from '@/containers/dialogs/ErrorDialog'
import LlamacppBusyOnExitDialog from '@/containers/dialogs/LlamacppBusyOnExitDialog'
import LlamacppOomListener from '@/containers/dialogs/LlamacppOomListener'
import MissingDependenciesDialog from '@/containers/dialogs/MissingDependenciesDialog'

export const Route = createRootRoute({
  component: RootLayout,
  errorComponent: ({ error }) => <GlobalError error={error} />,
})

const AppLayout = () => {
  const { productAnalyticPrompt } = useAnalytic()
  // The setup screen is the only onboarding surface: everything below that would
  // otherwise stack on top of it is deferred until it is done.
  const isOnboarding = useIsOnboarding()
  const {
    open: isLeftPanelOpen,
    setLeftPanel,
    width: sidebarWidth,
    setLeftPanelWidth,
  } = useLeftPanel()

  return (
    <div className="bg-neutral-50 dark:bg-background size-full relative">
      <SidebarProvider
        open={isLeftPanelOpen}
        onOpenChange={setLeftPanel}
        defaultWidth={sidebarWidth}
        onWidthChange={setLeftPanelWidth}
      >
        <AnalyticProvider />
        <KeyboardShortcutsProvider />
        {/* Fake absolute panel top to enable window drag */}
        {(IS_WINDOWS || IS_LINUX) && <WindowControls />}
        {IS_LINUX && <WindowResizeGrips />}
        {IS_TAURI && (
          <div
            className="fixed w-full h-12 z-20 top-0 cursor-grab active:cursor-grabbing"
            title="Drag window"
            aria-label="Window drag area"
            data-tauri-drag-region
          />
        )}
        <DialogAppUpdater />
        {!isOnboarding && <BackendUpdater />}
        <LeftSidebar />
        <SidebarInset>
          <div className="bg-neutral-50 dark:bg-background size-full">
            <Outlet />
          </div>
        </SidebarInset>

        {productAnalyticPrompt && !isOnboarding && <PromptAnalytic />}
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
            <DownloadEventListener />
            {IS_LOGS_ROUTE ? <LogsLayout /> : <AppLayout />}
          </ExtensionProvider>
          {/* <TanStackRouterDevtools position="bottom-right" /> */}
          <AttachmentIngestionDialog />
          <ErrorDialog />
          <LlamacppBusyOnExitDialog />
          <LlamacppOomListener />
          <MissingDependenciesDialog />
          <OutOfContextPromiseModal />
        </TranslationProvider>
      </ServiceHubProvider>
    </Fragment>
  )
}
