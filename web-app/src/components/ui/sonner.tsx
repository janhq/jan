import { Toaster as Sonner, ToasterProps } from 'sonner'
import { useTheme } from '@/hooks/useTheme'

const Toaster = ({ ...props }: ToasterProps) => {
  const isDark = useTheme((s) => s.isDark)

  return (
    <Sonner
      theme={isDark ? 'dark' : 'light'}
      className="toaster group"
      style={
        {
          // Neutral toasts pick up the accent tint (Appearance > Accent color,
          // exposed as --primary). richColors typed toasts keep their semantics.
          '--normal-bg':
            'color-mix(in oklch, var(--popover) 92%, var(--primary))',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border':
            'color-mix(in oklch, var(--border) 55%, var(--primary))',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
