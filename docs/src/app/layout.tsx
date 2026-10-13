import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Provider } from '@/components/provider'
import { Navbar } from '@/components/navbar'
import { Footer } from '@/components/footer'
import { defaultDescription, defaultOgImage, siteName, siteUrl } from '@/lib/shared'
import './global.css'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
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
        <Provider>
          <Navbar />
          <div className="flex-1">{children}</div>
          <Footer />
        </Provider>
      </body>
    </html>
  )
}
