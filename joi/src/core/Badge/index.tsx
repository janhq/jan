import React, { HTMLAttributes } from 'react'

import { cva, type VariantProps } from 'class-variance-authority'

import { twMerge } from 'tailwind-merge'

import './styles.scss'

const badgeVariants = cva('badge', {
  variants: {
    theme: {
      primary: 'badge--primary',
      secondary: 'badge--secondary',
      warning: 'badge--warning',
      success: 'badge--success',
      info: 'badge--info',
      destructive: 'badge--destructive',
    },
    variant: {
      solid: 'badge--solid',
      soft: 'badge--soft',
      outline: 'badge--outline',
    },
    size: {
      small: 'badge--small',
      medium: 'badge--medium',
      large: 'badge--large',
    },
  },
  defaultVariants: {
    theme: 'primary',
    size: 'medium',
    variant: 'solid',
  },
})

export interface BadgeProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = ({ className, theme, size, variant, ...props }: BadgeProps) => {
  return (
    <div
      className={twMerge(badgeVariants({ theme, size, variant, className }))}
      {...props}
    />
  )
}

export { Badge }
