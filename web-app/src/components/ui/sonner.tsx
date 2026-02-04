import { Toaster as Sonner, ToasterProps } from 'sonner'

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
<<<<<<< HEAD
      // theme={theme as ToasterProps['theme']}
      className="toaster group"
      // style={
      //   {
      //     '--normal-bg': 'var(--app-main-view)',
      //     '--normal-text': 'var(--popover-foreground)',
      //     '--normal-border': 'var(--border)',
      //   } as React.CSSProperties
      // }
=======
      className="toaster group"
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
      {...props}
    />
  )
}

export { Toaster }
