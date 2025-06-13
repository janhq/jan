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
        },
        classNames: {
          toast: 'toast',
          title: '!text-main-view/90',
          description: '!text-main-view/70',
        },
      }}
    />
  )
}
