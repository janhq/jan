import { useEffect } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { useInterfaceSettings } from '@/hooks/useInterfaceSettings'
import { getToastOffset } from '@/utils/toastPlacement'
import { flushCoworkStartupWarnings } from '@/lib/coworkSync'

export function ToasterProvider() {
  const notificationPosition = useInterfaceSettings(
    (s) => s.notificationPosition
  )

  // Startup warnings can be raised before any <Toaster> exists (providers gate
  // rendering on startup), and sonner drops pre-mount toasts. The child
  // <Toaster>'s subscription effect runs before this parent effect, so
  // re-raising here is reliably visible.
  useEffect(() => {
    flushCoworkStartupWarnings()
  }, [])

  return (
    <Toaster
      richColors
      position={notificationPosition}
      offset={getToastOffset(notificationPosition)}
      visibleToasts={5}
      toastOptions={{
        style: {
          padding: '1rem 0.8rem',
          alignItems: 'start',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          MozUserSelect: 'none',
          msUserSelect: 'none',
        },
        classNames: {
          toast: 'toast select-none',
          title: 'select-none',
          description: 'select-none',
        },
      }}
    />
  )
}
