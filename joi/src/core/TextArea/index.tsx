import React, { forwardRef, useRef, useEffect } from 'react'
import { twMerge } from 'tailwind-merge'

import './styles.scss'

type ResizeProps = {
  autoResize?: boolean
  minResize?: number
  maxResize?: number
}

export interface TextAreaProps
  extends ResizeProps,
    React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  (
    { autoResize, minResize = 80, maxResize = 250, className, ...props },
    ref
  ) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    useEffect(() => {
      if (autoResize && textareaRef.current) {
        const textarea = textareaRef.current
        textarea.style.height = 'auto'
        const scrollHeight = textarea.scrollHeight
        const newHeight = Math.min(maxResize, Math.max(minResize, scrollHeight))
        textarea.style.height = `${newHeight}px`
        textarea.style.overflow = newHeight >= maxResize ? 'auto' : 'hidden'
      }
    }, [props.value, autoResize, minResize, maxResize])

    return (
      <div className="textarea__wrapper">
        <textarea
          className={twMerge(
            'textarea',
            className,
            autoResize && 'resize-none'
          )}
          ref={autoResize ? textareaRef : ref}
          {...props}
        />
      </div>
    )
  }
)

export { TextArea }
