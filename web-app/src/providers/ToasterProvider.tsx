import { Toaster } from '@/components/ui/sonner'

export function ToasterProvider() {
  return (
    <Toaster
      richColors
      position="top-right"
      offset={{ top: 8, right: 8 }}
      toastOptions={{
        style: {
<<<<<<< HEAD
          background: 'var(--app-main-view-fg)',
          padding: '0.5rem 0.8rem',
          alignItems: 'start',
          borderColor:
            'color-mix(in oklch, var(--app-main-view) 5%, transparent)',
=======
          background: 'var(--background)',
          padding: '1rem 0.8rem',
          alignItems: 'start',
          borderColor: 'var(--border)',
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
          userSelect: 'none',
          WebkitUserSelect: 'none',
          MozUserSelect: 'none',
          msUserSelect: 'none',
        },
        classNames: {
          toast: 'toast select-none',
<<<<<<< HEAD
          title: '!text-main-view/90 select-none',
          description: '!text-main-view/70 select-none',
=======
          title: 'text-foreground! select-none',
          description: 'text-muted-foreground! select-none',
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
        },
      }}
    />
  )
}
