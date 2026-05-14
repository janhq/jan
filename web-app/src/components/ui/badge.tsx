import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full',
  {
    variants: {
      variant: {
        default: 'bg-blue-100 text-blue-700',
        success: 'bg-green-100 text-green-700',
        warning: 'bg-yellow-100 text-yellow-700',
        destructive: 'bg-destructive text-white dark:bg-destructive/60',
        outline:
          'border bg-background shadow-xs dark:bg-input/30 dark:border-input',
        secondary: 'bg-secondary text-foreground',
      },
      size: {
        default: 'font-medium text-xs px-2 py-1 rounded-lg',
        sm: 'text-sm px-3 py-1 rounded-md',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

function Badge({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : 'span'

  return (
    <Comp
      data-slot="span"
      data-variant={variant}
      data-size={size}
      className={cn(badgeVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
