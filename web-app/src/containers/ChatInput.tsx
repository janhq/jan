'use client'

import TextareaAutosize from 'react-textarea-autosize'
import { cn } from '@/lib/utils'
import { usePrompt } from '@/hooks/usePrompt'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ArrowRight } from 'lucide-react'
import {
  IconPaperclip,
  IconWorld,
  IconAtom,
  IconMicrophone,
} from '@tabler/icons-react'

type ChatInputProps = {
  className?: string
  disabled?: boolean
  isLoading?: boolean
  handleSubmit?: (e: React.MouseEvent<HTMLButtonElement>) => void
}

const ChatInput = ({
  className,
  disabled,
  handleSubmit,
  isLoading,
}: ChatInputProps) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [isFocused, setIsFocused] = useState(false)
  const { prompt, setPrompt } = usePrompt()

  useEffect(() => {
    const handleFocusIn = () => {
      if (document.activeElement === textareaRef.current) {
        setIsFocused(true)
      }
    }

    const handleFocusOut = () => {
      if (document.activeElement !== textareaRef.current) {
        setIsFocused(false)
      }
    }

    document.addEventListener('focusin', handleFocusIn)
    document.addEventListener('focusout', handleFocusOut)

    return () => {
      document.removeEventListener('focusin', handleFocusIn)
      document.removeEventListener('focusout', handleFocusOut)
    }
  }, [])

  useEffect(() => {
    if (!disabled && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [disabled])

  return (
    <div
      className={cn(
        'relative px-0 pt-4 pb-14 border border-neutral-900 rounded-xl bg-neutral-950',
        isFocused && 'ring-1 ring-neutral-800/50',
        disabled && 'opacity-50'
      )}
    >
      <TextareaAutosize
        ref={textareaRef}
        disabled={disabled}
        minRows={1}
        rows={1}
        maxRows={10}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && prompt) {
            e.preventDefault()
          }
        }}
        placeholder="Ask me anything..."
        autoFocus
        spellCheck={false}
        data-gramm={false}
        className={cn(
          'bg-transparent w-full flex-shrink-0 border-none resize-none outline-neutral-900 outline-0 px-4',
          'placeholder:text-placeholder',
          className
        )}
      />
      <div className="absolute bg-transparent bottom-0 w-full p-2 ">
        <div className="flex justify-between items-center w-full">
          <div className="px-1 flex items-center gap-1">
            <div className="h-6 p-1 flex items-center justify-center rounded hover:bg-neutral-800 transition-all duration-200 ease-in-out gap-1">
              <IconPaperclip size={18} className="text-neutral-400" />
              {/* <span className="text-xs text-neutral-300">Add File</span> */}
            </div>
            <div className="h-6 p-1 flex items-center justify-center rounded hover:bg-neutral-800 transition-all duration-200 ease-in-out gap-1">
              <IconMicrophone size={18} className="text-neutral-400" />
              {/* <span className="text-xs text-neutral-300">Microphone</span> */}
            </div>
            <div className="h-6 p-1 flex items-center justify-center rounded hover:bg-neutral-800 transition-all duration-200 ease-in-out gap-1">
              <IconWorld size={18} className="text-neutral-400" />
              {/* <span className="text-xs text-neutral-300">Web Search</span> */}
            </div>
            <div className="h-6 p-1 flex items-center justify-center rounded hover:bg-neutral-800 transition-all duration-200 ease-in-out gap-1">
              <IconAtom size={18} className="text-neutral-400" />
              {/* <span className="text-xs text-neutral-300">Thinking</span> */}
            </div>
          </div>
          <Button
            variant={!prompt ? null : 'default'}
            size="icon"
            disabled={!prompt}
            onClick={handleSubmit}
          >
            {isLoading ? (
              <span className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
            ) : (
              <ArrowRight />
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default ChatInput
