'use client'

import * as React from 'react'

import { SWRConfig } from 'swr'

function SWRConfigProvider({ children }: { children: React.ReactNode }) {
  // https://swr.vercel.app/docs/advanced/cache#localstorage-based-persistent-cache
  // When initializing, we restore the data from `localStorage` into a map.

  const map = React.useMemo(() => new Map<string, object>(), [])
  React.useEffect(() => {
    const savedCache = JSON.parse(
      window.localStorage.getItem('app-cache') || '[]'
    )
    savedCache.forEach(([key, value]: [string, object]) => {
      map.set(key, value)
    })

    // Before unloading the app, we write back all the data into `localStorage`.
    window.addEventListener('beforeunload', () => {
      const appCache = JSON.stringify(Array.from(map.entries()))
      window.localStorage.setItem('app-cache', appCache)
    })
  }, [map])

  return <SWRConfig value={{ provider: () => map }}>{children}</SWRConfig>
}

export default SWRConfigProvider
