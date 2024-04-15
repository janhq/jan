import { forwardRef } from 'react'
import { twMerge } from 'tailwind-merge'

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  textAlign?: 'left' | 'right'
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, textAlign, ...props }, ref) => {
    return (
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
    )
  }
)
Input.displayName = 'Input'

export { Input }
