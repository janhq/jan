import React, { HTMLAttributes } from 'react'

import { cva, type VariantProps } from 'class-variance-authority'

import { twMerge } from 'tailwind-merge'

import './styles.scss'

const progressVariants = cva('progress', {
  variants: {
    size: {
      small: 'progress--small',
      medium: 'progress--medium',
      large: 'progress--large',
    },
  },
  defaultVariants: {
    size: 'medium',
  },
})

export interface ProgressProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof progressVariants> {
  value: number
}

const Progress = ({ className, size, value, ...props }: ProgressProps) => {
  return (
    <div className={twMerge(progressVariants({ size, className }))} {...props}>
      <div
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
        className="progress--indicator"
      />
    </div>
  )
}

export { Progress }
