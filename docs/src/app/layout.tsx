import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Provider } from '@/components/provider'
import { Navbar } from '@/components/navbar'
import { defaultDescription, defaultOgImage, isNightly, siteName, siteUrl } from '@/lib/shared'
import { getSearchPages } from '@/lib/search-pages'
import './global.css'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  robots: isNightly ? { index: false, follow: false } : undefined,
  title: { default: 'Jan Docs', template: `%s - ${siteName}` },
  description: defaultDescription,
  icons: { icon: '/favicon.ico' },
  openGraph: {
    type: 'website',
    siteName,
    images: [{ url: defaultOgImage, alt: 'Jan-OGImage' }],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@jandotai',
  },
}

const structuredData = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Jan',
  url: 'https://jan.ai',
  logo: 'https://jan.ai/assets/images/general/og-image.png',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </head>
      <body className="flex min-h-screen flex-col font-sans">
        <Provider searchPages={getSearchPages()}>
          <Navbar />
          {isNightly && (
            <aside aria-label="Nightly documentation" className="border-b border-amber-300 bg-amber-50 px-6 py-3 text-center text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
              <strong>Nightly documentation.</strong> These docs cover unreleased changes and may be unstable.{' '}
              <a href="https://docs.jan.ai" className="font-medium underline underline-offset-2">View stable docs</a>.
            </aside>
          )}
          <div className="flex-1">{children}</div>
        </Provider>
      </body>
    </html>
  )
}
