import React, { ReactNode, forwardRef, useRef, useEffect } from 'react'
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
    { autoResize, minResize = 84, maxResize = 250, className, ...props },
    ref
  ) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    useEffect(() => {
      if (autoResize && textareaRef.current?.clientHeight) {
        const textarea = textareaRef.current
        textarea.style.height = minResize + 'px'
        textarea.style.overflow = 'hidden'

        const scrollHeight = textareaRef.current.scrollHeight

        textareaRef.current.style.height = scrollHeight + 'px'

        textareaRef.current.style.height =
          textareaRef.current.scrollHeight + 'px'

        textareaRef.current.style.maxHeight = maxResize + 'px'

        textareaRef.current.style.overflow =
          textareaRef.current.scrollHeight >= maxResize ? 'auto' : 'hidden'
      }
    }, [props.value])

    return (
      <div className="textarea__wrapper">
        <textarea
          className={twMerge('textarea', className)}
          ref={autoResize ? textareaRef : ref}
          {...props}
        />
      </div>
    )
  }
)

export { TextArea }
