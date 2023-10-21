import React from 'react'
import { PropsWithChildren, ButtonHTMLAttributes } from 'react'

import { cva, VariantProps } from 'class-variance-authority'

import { twMerge } from 'tailwind-merge'

const button = cva(
  'focus:outline-none focus:ring-blue-300 focus:ring-2 items-center inline-flex justify-center font-bold px-4 min-w-[80px] transition-colors',
  {
    variants: {
      theme: {
        primary: 'bg-blue-500 text-white hover:bg-blue-600',
        default: [
          'text-gray-700 border',
          'border-gray-300 bg-white hover:bg-gray-100',
          'dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800/50',
        ],
        warning: 'bg-yellow-700 text-white hover:bg-yellow-800',
        success: 'bg-green-700 text-white hover:bg-green-800',
        danger: 'bg-red-700 text-white hover:bg-red-800',
      },
      block: {
        true: 'w-full',
      },
      size: {
        small: 'h-8 text-xs rounded-md',
        medium: 'h-10 text-sm rounded-md',
        large: 'h-12 text-sm rounded-md',
      },
      disabled: {
        true: [
          'cursor-not-allowed',
          'bg-gray-200 text-gray-600 hover:bg-gray-200',
          'dark:bg-gray-800 dark:hover:bg-gray-800 dark:text-gray-700',
        ],
      },
      loading: {
        true: 'pointer-events-none',
      },
      outline: {
        true: 'bg-transparent border hover:bg-transparent dark:hover:bg-transparent',
      },
    },
    defaultVariants: {
      theme: 'default',
      size: 'medium',
      block: false,
      disabled: false,
      loading: false,
    },
    compoundVariants: [
      {
        theme: 'default',
        outline: true,
        class:
          'border-gray-300 text-gray-700 dark:border-gray-700 dark:text-gray-300',
      },
      {
        theme: 'primary',
        outline: true,
        class: 'border-blue-500 text-blue-500',
      },
      {
        theme: 'danger',
        outline: true,
        class: 'border-red-700 text-red-700',
      },
      {
        theme: 'warning',
        outline: true,
        class: 'border-yellow-700 text-yellow-700',
      },
      {
        theme: 'success',
        outline: true,
        class: 'border-green-700 text-green-700',
      },
    ],
  }
)

export type ButtonThemeProps = NonNullable<VariantProps<typeof button>['theme']>

export type ButtonSizeProps = NonNullable<VariantProps<typeof button>['size']>

export interface ButtonProps
  extends PropsWithChildren,
    Pick<
      ButtonHTMLAttributes<HTMLButtonElement>,
      'onClick' | 'type' | 'id' | 'form'
    >,
    VariantProps<typeof button> {
  className?: string
  testId?: string
}

export const Button = (props: ButtonProps) => {
  const {
    loading,
    children,
    disabled,
    theme,
    outline,
    form,
    type,
    onClick,
    block,
    id,
    className,
    size,
  } = props

  return (
    <button
      id={id}
      role="button"
      form={form}
      type={type || 'button'}
      className={twMerge(
        button({
          theme,
          block,
          size,
          disabled,
          className,
          loading,
          outline,
        })
      )}
      disabled={disabled as boolean}
      onClick={onClick}
    >
      {loading ? (
        <svg
          aria-hidden="true"
          role="status"
          className="h-4 animate-spin"
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
      ) : (
        children
      )}
    </button>
  )
}
