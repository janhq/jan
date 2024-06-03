import React, { ReactNode, forwardRef } from 'react'
import { twMerge } from 'tailwind-merge'

import './styles.scss'

export interface Props extends React.InputHTMLAttributes<HTMLInputElement> {
  textAlign?: 'left' | 'right'
  prefixIcon?: ReactNode
  suffixIcon?: ReactNode
  onCLick?: () => void
}

const Input = forwardRef<HTMLInputElement, Props>(
  (
    { className, type, textAlign, prefixIcon, suffixIcon, onClick, ...props },
    ref
  ) => {
    return (
      <div className="input__wrapper">
        {prefixIcon && (
          <div className="input__prefix-icon" onClick={onClick}>
            {prefixIcon}
          </div>
        )}
        {suffixIcon && (
          <div className="input__suffix-icon" onClick={onClick}>
            {suffixIcon}
          </div>
        )}
        <input
          type={type}
          className={twMerge(
            'input',
            className,
            textAlign === 'right' && 'text-right'
          )}
          ref={ref}
          onClick={onClick}
          {...props}
        />
      </div>
    )
  }
)

export { Input }
