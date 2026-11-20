import type { PropsWithChildren } from 'react'
import { ServiceHubProvider } from './ServiceHubProvider'
import { ExtensionProvider } from './ExtensionProvider'
import { TranslationProvider } from '@/i18n/TranslationContext'

/**
 * Startup must live OUTSIDE RouterProvider: initial beforeLoad runs before the
 * root route mounts. Keeping these gates in RootLayout prevents a direct thread
 * link from ever initializing the services its classification needs. Settings
 * and Cowork migration still hydrate before extensions, then route loading.
 */
export function StartupProvider({ children }: PropsWithChildren) {
  return (
    <ServiceHubProvider>
      <TranslationProvider>
        <ExtensionProvider>{children}</ExtensionProvider>
      </TranslationProvider>
    </ServiceHubProvider>
  )
}
