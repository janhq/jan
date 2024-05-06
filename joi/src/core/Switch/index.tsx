import React, { ChangeEvent, InputHTMLAttributes } from 'react'

import { twMerge } from 'tailwind-merge'

import './styles.scss'

export interface SwitchProps extends InputHTMLAttributes<HTMLInputElement> {
  disabled?: boolean
  className?: string
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void
}

const Switch = ({
  name,
  checked,
  disabled,
  defaultChecked,
  className,
  onChange,
  ...props
}: SwitchProps) => {
  return (
    <label className={twMerge('switch', className)}>
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        {...props}
      />
      <span className="switch--thumb" />
    </label>
  )
}
export { Switch }
