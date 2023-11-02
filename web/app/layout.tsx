import { PropsWithChildren } from 'react'

import { Metadata } from 'next'

import Providers from '@/containers/Providers'

import '@/styles/main.scss'

export const metadata: Metadata = {
  title: 'Jan',
  description:
    'Self-hosted, local, AI Inference Platform that scales from personal use to production deployments for a team.',
}

type Props = PropsWithChildren

export default function RootLayout({ children }: Props) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background/40 text-xs antialiased">
        <div className="title-bar" />
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
