import React, { ReactNode, forwardRef } from 'react'
import { twMerge } from 'tailwind-merge'

import './styles.scss'

export interface Props extends React.InputHTMLAttributes<HTMLInputElement> {
  textAlign?: 'left' | 'right'
  prefixIcon?: ReactNode
  suffixIcon?: ReactNode
}

const Input = forwardRef<HTMLInputElement, Props>(
  ({ className, type, textAlign, prefixIcon, suffixIcon, ...props }, ref) => {
    return (
      <div className="input__wrapper">
        {prefixIcon && <div className="input__prefix-icon">{prefixIcon}</div>}
        {suffixIcon && <div className="input__suffix-icon">{suffixIcon}</div>}
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
