import React, { ReactNode, forwardRef } from 'react'
import { twMerge } from 'tailwind-merge'

import './styles.scss'
import { Cross2Icon } from '@radix-ui/react-icons'

export interface Props extends React.InputHTMLAttributes<HTMLInputElement> {
  textAlign?: 'left' | 'right'
  prefixIcon?: ReactNode
  suffixIcon?: ReactNode
  onCLick?: () => void
  clearable?: boolean
  onClear?: () => void
}

const Input = forwardRef<HTMLInputElement, Props>(
  (
    {
      className,
      type,
      textAlign,
      prefixIcon,
      suffixIcon,
      onClick,
      onClear,
      clearable,
      ...props
    },
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
        {clearable && (
          <div className="input__clear-icon" onClick={onClear}>
            <Cross2Icon data-testid="cross-2-icon" className="text-red-200" />
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
