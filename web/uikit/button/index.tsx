import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { twMerge } from 'tailwind-merge'

const buttonVariants = cva(
  'cursor-pointer inline-flex items-center justify-center whitespace-nowrap rounded-md font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:bg-background-reverse disabled:text-background/50 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      themes: {
        default:
          'hover:bg-background-reverse/90 bg-background-reverse text-background',
        accent: 'hover:bg-accent/90 bg-accent text-white',
        outline: 'border border-border bg-background/50  hover:bg-accent/20',
      },
      size: {
        sm: 'h-6 px-2 text-xs rounded-md',
        default: 'h-8 px-3',
      },
      loading: {
        true: 'pointer-events-none opacity-70',
      },
    },
    defaultVariants: {
      themes: 'default',
      size: 'default',
      loading: false,
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, themes, size, loading, asChild = false, children, ...props },
    ref
  ) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={twMerge(
          buttonVariants({ themes, size, loading, className })
        )}
        ref={ref}
        {...props}
      >
        {loading ? (
          <>
            <svg
              aria-hidden="true"
              role="status"
              className="mr-2 h-4 animate-spin"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                className="opacity-75"
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
