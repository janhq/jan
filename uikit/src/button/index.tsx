'use client'

import { forwardRef, ButtonHTMLAttributes } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { twMerge } from 'tailwind-merge'

const buttonVariants = cva('btn', {
  variants: {
    themes: {
      primary: 'btn-primary',
      danger: 'btn-danger',
      outline: 'btn-outline',
      secondary: 'btn-secondary',
      secondaryBlue: 'btn-secondary-blue',
      secondaryDanger: 'btn-secondary-danger',
      ghost: 'btn-ghost',
      success: 'btn-success',
    },
    size: {
      sm: 'btn-sm',
      md: 'btn-md',
      lg: 'btn-lg',
    },
    block: {
      true: 'w-full',
    },
    loading: {
      true: 'btn-loading',
    },
  },
  defaultVariants: {
    themes: 'primary',
    size: 'md',
  },
})

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      themes,
      size,
      block,
      loading,
      asChild = false,
      children,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={twMerge(
          buttonVariants({ themes, size, block, loading, className })
        )}
        ref={ref}
        {...props}
      >
        {loading ? (
          <>
            <svg
              aria-hidden="true"
              role="status"
              className="btn-loading-circle"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
            {children}
          </>
        ) : (
          children
        )}
      </Comp>
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
