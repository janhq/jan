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
import { useTranslation } from 'react-i18next'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'

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
  const [rows, setRows] = useState(1)
  const { prompt, setPrompt } = usePrompt()
  const { t } = useTranslation()
  const { spellCheckChatInput } = useGeneralSetting()
  const maxRows = 10

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
        'relative px-0 pt-4 pb-14 border border-main-view-fg/5 rounded-xl text-main-view-fg bg-main-view-fg/2',
        isFocused && 'ring-1 ring-main-view-fg/10',
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
        onChange={(e) => {
          setPrompt(e.target.value)
          // Count the number of newlines to estimate rows
          const newRows = (e.target.value.match(/\n/g) || []).length + 1
          setRows(Math.min(newRows, maxRows))
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (!e.shiftKey && prompt) {
              e.preventDefault()
              // Submit the message when Enter is pressed without Shift
              if (handleSubmit) {
                handleSubmit(
                  e as unknown as React.MouseEvent<HTMLButtonElement>
                )
              }
            }
            // When Shift+Enter is pressed, a new line is added (default behavior)
          }
        }}
        placeholder={t('common.placeholder.chatInput')}
        autoFocus
        spellCheck={spellCheckChatInput}
        data-gramm={spellCheckChatInput}
        data-gramm_editor={spellCheckChatInput}
        data-gramm_grammarly={spellCheckChatInput}
        className={cn(
          'bg-transparent w-full flex-shrink-0 border-none resize-none outline-0 px-4',
          rows < maxRows && 'scrollbar-hide',
          className
        )}
      />
      <div className="absolute bg-transparent bottom-0 w-full p-2 ">
        <div className="flex justify-between items-center w-full">
          <div className="px-1 flex items-center gap-1">
            <div className="h-6 p-1 flex items-center justify-center rounded-sm hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out gap-1">
              <IconPaperclip size={18} className="text-main-view-fg/50" />
              {/* <span className="text-xs text-neutral-300">Add File</span> */}
            </div>
            <div className="h-6 p-1 flex items-center justify-center rounded-sm hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out gap-1">
              <IconMicrophone size={18} className="text-main-view-fg/50" />
              {/* <span className="text-xs text-neutral-300">Microphone</span> */}
            </div>
            <div className="h-6 p-1 flex items-center justify-center rounded-sm hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out gap-1">
              <IconWorld size={18} className="text-main-view-fg/50" />
              {/* <span className="text-xs text-neutral-300">Web Search</span> */}
            </div>
            <div className="h-6 p-1 flex items-center justify-center rounded-sm hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out gap-1">
              <IconAtom size={18} className="text-main-view-fg/50" />
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
              <ArrowRight className="text-primary-fg" />
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default ChatInput
