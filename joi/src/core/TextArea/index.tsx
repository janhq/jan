import React, { ReactNode, forwardRef } from 'react'
import { twMerge } from 'tailwind-merge'

import './styles.scss'

export interface TextAreaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  ({ className, ...props }, ref) => {
    return (
      <div className="textarea__wrapper">
        <textarea
          className={twMerge('textarea', className)}
          ref={ref}
          {...props}
        />
      </div>
    )
  }
)

export { TextArea }
