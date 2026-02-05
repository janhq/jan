import { useEffect, useMemo } from 'react'
import { useRouter } from '@tanstack/react-router'

// Detect if the user is on macOS
const isMac =
  typeof navigator !== 'undefined' &&
  navigator.userAgent.toUpperCase().indexOf('MAC') >= 0

interface UseKeyboardShortcutProps {
  key: string
  metaKey?: boolean // Will be used for macOS
  ctrlKey?: boolean // Will be used for Windows/Linux
  altKey?: boolean
  shiftKey?: boolean
  callback?: () => void
  excludeRoutes?: string[]
  usePlatformMetaKey?: boolean // If true, will use Command on Mac and Ctrl on Windows/Linux
}

export function useKeyboardShortcut({
  key,
  metaKey = false,
  ctrlKey = false,
  altKey = false,
  shiftKey = false,
  callback,
  excludeRoutes = [],
  usePlatformMetaKey = false,
}: UseKeyboardShortcutProps) {
  // If usePlatformMetaKey is true, use Command on Mac and Ctrl on Windows/Linux
  const effectiveMetaKey = useMemo(() => {
    if (usePlatformMetaKey) {
      return isMac
    }
    return metaKey
  }, [metaKey, usePlatformMetaKey])

  const effectiveCtrlKey = useMemo(() => {
    if (usePlatformMetaKey) {
      return !isMac
    }
    return ctrlKey
  }, [ctrlKey, usePlatformMetaKey])
  const router = useRouter()
  const pathname = router.state.location.pathname

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if we're on an excluded route
      if (excludeRoutes.includes(pathname)) {
        // console.warn('Excluded route, not executing shortcut')
        return
      }

      // Check if the key combination matches
      if (
        e.key.toLowerCase() === key.toLowerCase() &&
        e.metaKey === effectiveMetaKey &&
        e.ctrlKey === effectiveCtrlKey &&
        e.altKey === altKey &&
        e.shiftKey === shiftKey
      ) {
        e.preventDefault()

        if (callback) {
          callback()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    key,
    effectiveMetaKey,
    effectiveCtrlKey,
    altKey,
    shiftKey,
    callback,
    pathname,
    excludeRoutes,
  ])
}
