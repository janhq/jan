import { Toaster } from '@/components/ui/sonner'

export function ToasterProvider() {
  return (
    <Toaster
      richColors
      position="top-right"
      offset={{ top: 8, right: 8 }}
      toastOptions={{
        style: {
          background: 'var(--app-main-view-fg)',
          padding: '0.5rem 0.8rem',
          alignItems: 'start',
          borderColor:
            'color-mix(in oklch, var(--app-main-view) 5%, transparent)',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          MozUserSelect: 'none',
          msUserSelect: 'none',
        },
        classNames: {
          toast: 'toast select-none',
          title: '!text-main-view/90 select-none',
          description: '!text-main-view/70 select-none',
        },
      }}
    />
  )
}
