import { useMemo } from 'react'

// Detect if the user is on macOS
const isMac =
  typeof navigator !== 'undefined' &&
  navigator.userAgent.toUpperCase().indexOf('MAC') >= 0

export function PlatformMetaKey() {
  const metaKeySymbol = useMemo(() => {
    return isMac ? '⌘' : 'Ctrl'
  }, [])

  return <>{metaKeySymbol}</>
}
