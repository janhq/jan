import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  cn(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none aria-invalid:ring-destructive/60 aria-invalid:border-destructive cursor-pointer",
    'focus:border-accent focus:ring-2 focus:ring-accent/50 focus:accent-[0px]',
    'focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:accent-[0px]'
  ),
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-fg shadow-xs hover:bg-primary/90 focus-visible:ring-primary/60 focus:ring-primary/60 focus:border-primary focus-visible:border-primary',
        destructive:
          'bg-destructive shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/60 text-destructive-fg focus:border-destructive focus:ring-destructive/60',
        outline:
          'border border-main-view-fg/20 bg-transparent text-main-view-fg hover:bg-main-view/60 hover:text-main-view-fg focus-visible:ring-main-view-fg/40 focus:border-main-view-fg',
        ghost:
          'bg-transparent text-main-view-fg hover:bg-main-view/60 focus-visible:ring-main-view-fg/40 focus:border-main-view-fg',
        link: 'underline-offset-4 hover:no-underline',
      },
      size: {
        default: 'h-7 px-3 py-2 has-[>svg]:px-3 rounded-sm',
        sm: 'h-6 gap-1.5 px-2 has-[>svg]:px-2.5 rounded-sm',
        lg: 'h-9 rounded-md px-4 has-[>svg]:px-4',
        icon: 'size-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export { Button, buttonVariants }
