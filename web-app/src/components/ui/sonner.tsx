import { Toaster as Sonner, ToasterProps } from 'sonner'

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      // theme={theme as ToasterProps['theme']}
      className="toaster group"
      // style={
      //   {
      //     '--normal-bg': 'var(--app-main-view)',
      //     '--normal-text': 'var(--popover-foreground)',
      //     '--normal-border': 'var(--border)',
      //   } as React.CSSProperties
      // }
      {...props}
    />
  )
}

export { Toaster }
