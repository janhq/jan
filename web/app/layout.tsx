import { PropsWithChildren } from 'react'

import { Metadata } from 'next'

import { Inter } from 'next/font/google'

import Providers from '@/containers/Providers'

import '@/styles/main.scss'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

export const metadata: Metadata = {
  title: 'Jan',
  description:
    'Self-hosted, local, AI Inference Platform that scales from personal use to production deployments for a team.',
}

export default function RootLayout({ children }: PropsWithChildren) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable}`}>
      <body className="bg-background/50 font-sans text-sm antialiased">
        <div className="title-bar" />
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
