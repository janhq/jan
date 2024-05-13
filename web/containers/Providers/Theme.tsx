'use client'
import React from 'react'

import { PropsWithChildren } from 'react'

import { ThemeProvider } from 'next-themes'

export default function ThemeWrapper({ children }: PropsWithChildren) {
  return (
    <ThemeProvider attribute="class" enableSystem={false}>
      {children}
    </ThemeProvider>
  )
}
