import React, { ChangeEvent, InputHTMLAttributes, ReactNode } from 'react'

import { twMerge } from 'tailwind-merge'

import './styles.scss'

export interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  disabled?: boolean
  className?: string
  label?: ReactNode
  helperDescription?: ReactNode
  errorMessage?: string
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void
}

const Checkbox = ({
  id,
  name,
  checked,
  disabled,
  label,
  defaultChecked,
  helperDescription,
  errorMessage,
  className,
  onChange,
  ...props
}: CheckboxProps) => {
  return (
    <div className={twMerge('checkbox', className)}>
      <input
        id={id}
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        {...props}
      />
      <div>
        <label htmlFor={id} className="checkbox__label">
          {label}
        </label>
        <p className="checkbox__helper">{helperDescription}</p>
        {errorMessage && <p className="checkbox__error">{errorMessage}</p>}
      </div>
    </div>
  )
}
export { Checkbox }
