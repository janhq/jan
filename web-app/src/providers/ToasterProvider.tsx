import { Toaster } from '@/components/ui/sonner'
import { useInterfaceSettings } from '@/hooks/useInterfaceSettings'
import { getToastOffset } from '@/utils/toastPlacement'

export function ToasterProvider() {
  const notificationPosition = useInterfaceSettings(
    (s) => s.notificationPosition
  )

  return (
    <Toaster
      richColors
      position={notificationPosition}
      offset={getToastOffset(notificationPosition)}
      visibleToasts={5}
      toastOptions={{
        style: {
          background: 'var(--background)',
          padding: '1rem 0.8rem',
          alignItems: 'start',
          borderColor: 'var(--border)',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          MozUserSelect: 'none',
          msUserSelect: 'none',
        },
        classNames: {
          toast: 'toast select-none',
          title: 'text-foreground! select-none',
          description: 'text-muted-foreground! select-none',
        },
      }}
    />
  )
}
