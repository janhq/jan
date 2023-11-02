'use client'
import React, { ReactNode } from 'react'

import { SessionProvider } from 'next-auth/react'

const SessionProviderWrapper: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  return <SessionProvider>{children}</SessionProvider>
}

export default SessionProviderWrapper
