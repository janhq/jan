import { createRootRoute, Outlet, useRouterState } from '@tanstack/react-router'
// import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'

import LeftPanel from '@/containers/LeftPanel'
import { Fragment } from 'react/jsx-runtime'
import { AppearanceProvider } from '@/providers/AppearanceProvider'
import { ThemeProvider } from '@/providers/ThemeProvider'
import { KeyboardShortcutsProvider } from '@/providers/KeyboardShortcuts'
import { DataProvider } from '@/providers/DataProvider'
import { route } from '@/constants/routes'
import { ExtensionProvider } from '@/providers/ExtensionProvider'
import { ToasterProvider } from '@/providers/ToasterProvider'

export const Route = createRootRoute({
  component: RootLayout,
})

const AppLayout = () => {
  return (
    <Fragment>
      <ExtensionProvider>
        <DataProvider />
      </ExtensionProvider>
      <KeyboardShortcutsProvider />
      <main className="relative h-svh text-sm antialiased select-none bg-app">
        {/* Fake absolute panel top to enable window drag */}
        <div className="absolute w-full h-10 z-10" data-tauri-drag-region />

        <div className="flex h-full">
          {/* left content panel - only show if not logs route */}
          <LeftPanel />

          {/* Main content panel */}
          <div className="h-full flex w-full p-1">
            <div className="bg-main-view text-main-view-fg border border-main-view-fg/5 w-full rounded-lg overflow-hidden">
              <Outlet />
            </div>
          </div>
        </div>
      </main>
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
    router.location.pathname === route.localApiServerlogs

  return (
    <Fragment>
      <ThemeProvider />
      <AppearanceProvider />
      <ToasterProvider />
      {isLocalAPIServerLogsRoute ? <LogsLayout /> : <AppLayout />}
      {/* <TanStackRouterDevtools position="bottom-right" /> */}
    </Fragment>
  )
}
