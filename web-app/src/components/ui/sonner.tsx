import { Toaster as Sonner, ToasterProps } from 'sonner'
import { useTheme } from '@/hooks/useTheme'

const Toaster = ({ ...props }: ToasterProps) => {
  const isDark = useTheme((s) => s.isDark)

  // CSS-var tinting lives in index.css (.toaster); an inline style prop here
  // violates WebView2's hashed style-src CSP and gets dropped.
  return (
    <Sonner
      theme={isDark ? 'dark' : 'light'}
      className="toaster group"
      {...props}
    />
  )
}

export { Toaster }
