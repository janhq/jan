import { useMemo } from 'react'
import { isMac } from '@/lib/shortcuts'

export function PlatformMetaKey() {
  const metaKeySymbol = useMemo(() => {
    return isMac ? '⌘' : 'Ctrl'
  }, [])

  return <>{metaKeySymbol}</>
}
