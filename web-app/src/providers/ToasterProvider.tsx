import { Toaster } from '@/components/ui/sonner'

export function ToasterProvider() {
  return (
    <Toaster
      richColors
      position="top-right"
      offset={{ top: 8, right: 8 }}
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
