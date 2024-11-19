import { PropsWithChildren } from 'react'

import { Metadata } from 'next'

import '@/styles/main.scss'

import { CSPostHogProvider } from './posthog'

export const metadata: Metadata = {
  title: 'Jan',
  description:
    'Self-hosted, local, AI Inference Platform that scales from personal use to production deployments for a team.',
}

export default function RootLayout({ children }: PropsWithChildren) {
  return (
    <html lang="en" suppressHydrationWarning>
      <CSPostHogProvider>
        <body className="h-screen font-sans text-sm antialiased">
          <div className="dragable-bar" />
          {children}
        </body>
      </CSPostHogProvider>
    </html>
  )
}
