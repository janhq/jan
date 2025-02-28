import { PropsWithChildren } from 'react'

import { Metadata } from 'next'

import '@/styles/main.scss'

export const metadata: Metadata = {
  title: 'Jan',
  description:
    'Self-hosted, local, AI Inference Platform that scales from personal use to production deployments for a team.',
}

export default function RootLayout({ children }: PropsWithChildren) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="h-screen font-sans text-sm antialiased">{children}</body>
    </html>
  )
}
