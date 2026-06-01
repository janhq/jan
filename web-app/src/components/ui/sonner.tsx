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
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
