'use client'

import ClipboardListener from '@/containers/Providers/ClipboardListener'

import JotaiWrapper from '@/containers/Providers/Jotai'
import ThemeWrapper from '@/containers/Providers/Theme'

import Search from './page'

export default function RootLayout() {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-white font-sans text-sm antialiased dark:bg-background">
        <JotaiWrapper>
          <ThemeWrapper>
            <ClipboardListener>
              <Search />
            </ClipboardListener>
          </ThemeWrapper>
        </JotaiWrapper>
      </body>
    </html>
  )
}
