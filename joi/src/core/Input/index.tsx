import React, { ReactNode, forwardRef } from 'react'
import { twMerge } from 'tailwind-merge'

import './styles.scss'

export interface Props extends React.InputHTMLAttributes<HTMLInputElement> {
  textAlign?: 'left' | 'right'
  prefixIcon?: ReactNode
}

const Input = forwardRef<HTMLInputElement, Props>(
  ({ className, type, textAlign, prefixIcon, ...props }, ref) => {
    return (
      <div className="input__wrapper">
        {prefixIcon && <div className="input__prefix-icon">{prefixIcon}</div>}
        <input
          type={type}
          className={twMerge(
            'input',
            className,
            textAlign === 'right' && 'text-right'
          )}
          ref={ref}
          {...props}
        />
      </div>
    )
  }
)

export { Input }
