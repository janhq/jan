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
import { useEffect, type MouseEvent } from 'react'
import GlobalError from '@/containers/GlobalError'
import { GlobalEventHandler } from '@/providers/GlobalEventHandler'
import { ServiceHubProvider } from '@/providers/ServiceHubProvider'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { LeftSidebar } from '@/components/left-sidebar'
import { WindowControls } from '@/components/WindowControls'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import ErrorDialog from '@/containers/dialogs/ErrorDialog'
import MissingDependenciesDialog from '@/containers/dialogs/MissingDependenciesDialog'
import { ScreenCaptureProvider } from '@/providers/ScreenCaptureProvider'

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
        {IS_WINDOWS && <WindowControls />}
        {IS_TAURI && (
          <div
            className="fixed w-full h-12 z-20 top-0 cursor-grab active:cursor-grabbing"
            title="Drag window"
            aria-label="Window drag area"
            {...(IS_LINUX
              ? {
                  onMouseDown: (e: MouseEvent) => {
                    if (e.button !== 0) return
                    void getCurrentWebviewWindow().startDragging()
                  },
                }
              : { 'data-tauri-drag-region': true as const })}
          />
        )}
        <DialogAppUpdater />
        <BackendUpdater />
        <LeftSidebar />
        <SidebarInset>
          <div className="bg-neutral-50 dark:bg-background size-full">
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

/** Transparent shell for floating capture UI (no opaque LogsLayout — that blocked see-through). */
const BareCaptureLayout = () => {
  useEffect(() => {
    const html = document.documentElement
    const body = document.body
    html.classList.add('jan-bare-capture-webview')
    body.classList.add('jan-bare-capture-webview')
    return () => {
      html.classList.remove('jan-bare-capture-webview')
      body.classList.remove('jan-bare-capture-webview')
    }
  }, [])

  return (
    <div className="h-svh w-svw min-h-0 overflow-visible bg-transparent">
      <Outlet />
    </div>
  )
}

type ChromeLayout = 'app' | 'logs' | 'bare-capture'

function normalizePathname(pathname: string): string {
  const p = pathname.replace(/\/$/, '') || '/'
  return p === '' ? '/' : p
}

function getInitialChromeLayout(): ChromeLayout {
  const pathname = normalizePathname(window.location.pathname)
  if (
    pathname === route.screenCaptureOverlay ||
    pathname === route.screenCaptureRegion
  ) {
    return 'bare-capture'
  }
  if (
    pathname === route.localApiServerlogs ||
    pathname === route.systemMonitor ||
    pathname === route.appLogs
  ) {
    return 'logs'
  }
  return 'app'
}

function RootLayout() {
  const chromeLayout = getInitialChromeLayout()

  useEffect(() => {
    const hideLoader = () => {
      requestAnimationFrame(() => {
        document.body.classList.add('loaded')
        const loader = document.getElementById('initial-loader')
        if (loader) {
          setTimeout(() => loader.remove(), 300)
        }
      })
    }
    // Same timing for all webviews (including floating toolbar): logo splash until first paint settles.
    const timer = setTimeout(hideLoader, 200)
    return () => clearTimeout(timer)
  }, [])

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
            <ScreenCaptureProvider />
            {chromeLayout === 'bare-capture' ? (
              <BareCaptureLayout />
            ) : chromeLayout === 'logs' ? (
              <LogsLayout />
            ) : (
              <AppLayout />
            )}
          </ExtensionProvider>
          {/* <TanStackRouterDevtools position="bottom-right" /> */}
          <ToolApproval />
          <AttachmentIngestionDialog />
          <ErrorDialog />
          <MissingDependenciesDialog />
          <OutOfContextPromiseModal />
        </TranslationProvider>
      </ServiceHubProvider>
    </Fragment>
  )
}
