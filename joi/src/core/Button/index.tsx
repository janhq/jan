import React, { forwardRef, ButtonHTMLAttributes } from 'react'

import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { twMerge } from 'tailwind-merge'

import './styles.scss'

const buttonVariants = cva('btn', {
  variants: {
    theme: {
      primary: 'btn--primary',
      ghost: 'btn--ghost',
      destructive: 'btn--destructive',
    },
    variant: {
      solid: 'btn--solid',
      soft: 'btn--soft',
      outline: 'btn--outline',
    },
    size: {
      small: 'btn--small',
      medium: 'btn--medium',
      large: 'btn--large',
    },
    block: {
      true: 'btn--block',
    },
  },
  defaultVariants: {
    theme: 'primary',
    size: 'medium',
    variant: 'solid',
    block: false,
  },
})

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, theme, size, variant, block, asChild = false, ...props },
    ref
  ) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={twMerge(
          buttonVariants({ theme, size, variant, block, className })
        )}
        ref={ref}
        {...props}
      />
    )
  }
)

export { Button }
