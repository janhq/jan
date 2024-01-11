import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { twMerge } from 'tailwind-merge'

const badgeVariants = cva('badge', {
  variants: {
    themes: {
      primary: 'badge-primary',
      warning: 'badge-warning',
      success: 'badge-success',
      secondary: 'badge-secondary',
      danger: 'badge-danger',
      outline: 'badge-outline',
      pink: 'badge-pink',
    },
  },
  defaultVariants: {
    themes: 'primary',
  },
})

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, themes, ...props }: BadgeProps) {
  return (
    <div className={twMerge(badgeVariants({ themes }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
