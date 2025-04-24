import { createRootRoute, Outlet } from '@tanstack/react-router'
// import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'

import LeftPanel from '@/containers/LeftPanel'
import { Fragment } from 'react/jsx-runtime'
import { AppearanceProvider } from '@/providers/AppearanceProvider'
import { ThemeProvider } from '@/providers/ThemeProvider'
import { KeyboardShortcuts } from '@/providers/KeyboardShortcuts'

export const Route = createRootRoute({
  component: () => (
    <Fragment>
      <ThemeProvider />
      <AppearanceProvider />
      <KeyboardShortcuts />
      <main className="relative h-svh text-sm antialiased select-none bg-app">
        {/* Fake absolute panel top to enable window drag */}
        <div className="absolute w-full h-2 z-50" data-tauri-drag-region />

        <div className="flex h-full">
          {/* left content panel */}
          <LeftPanel />

          {/* Main content panel */}
          <div className="h-full flex w-full p-1">
            <div className="bg-main-view text-main-view-fg border border-main-view-fg/5 w-full rounded-lg overflow-hidden">
              <Outlet />
            </div>
          </div>
        </div>
      </main>
      {/* <TanStackRouterDevtools position="bottom-right" /> */}
    </Fragment>
  ),
})
