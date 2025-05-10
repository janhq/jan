'use client'

import TextareaAutosize from 'react-textarea-autosize'
import { cn } from '@/lib/utils'
import { usePrompt } from '@/hooks/usePrompt'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ArrowRight } from 'lucide-react'
import {
  IconPaperclip,
  IconWorld,
  IconAtom,
  IconMicrophone,
  IconEye,
  IconTool,
  IconCodeCircle2,
} from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useModelProvider } from '@/hooks/useModelProvider'
import {
  newAssistantThreadContent,
  newUserThreadContent,
  sendCompletion,
} from '@/lib/completion'
import { useThreads } from '@/hooks/useThreads'

type ChatInputProps = {
  className?: string
  disabled?: boolean
  isLoading?: boolean
}

const ChatInput = ({ className, disabled, isLoading }: ChatInputProps) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [isFocused, setIsFocused] = useState(false)
  const [rows, setRows] = useState(1)
  const { prompt, setPrompt } = usePrompt()
  const { t } = useTranslation()
  const { spellCheckChatInput } = useGeneralSetting()
  const maxRows = 10

  const { getProviderByName, selectedModel, selectedProvider } =
    useModelProvider()

  const {
    currentThreadId,
    getThreadById,
    addThreadContent,
    updateStreamingContent,
  } = useThreads()

  const provider = useMemo(() => {
    return getProviderByName(selectedProvider)
  }, [selectedProvider, getProviderByName])

  const thread = useMemo(
    () => currentThreadId && getThreadById(currentThreadId),
    [currentThreadId, getThreadById]
  )

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

  const sendMessage = useCallback(async () => {
    if (!thread || !provider || !currentThreadId) return
    addThreadContent(currentThreadId, newUserThreadContent(prompt))
    setPrompt('')
    const completion = await sendCompletion(thread, provider, prompt)

    if (completion) {
      const currentContent = newAssistantThreadContent('')
      for await (const part of completion) {
        currentContent.text!.value += part.choices[0]?.delta?.content || ''
        updateStreamingContent(currentContent)
      }
      addThreadContent(currentThreadId, currentContent)
      updateStreamingContent(undefined)
    }
  }, [
    thread,
    provider,
    currentThreadId,
    prompt,
    addThreadContent,
    setPrompt,
    updateStreamingContent,
  ])

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
              sendMessage()
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
            {/* File attachment - always available */}
            <div className="h-6 p-1 flex items-center justify-center rounded-sm hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out gap-1">
              <IconPaperclip size={18} className="text-main-view-fg/50" />
            </div>

            {/* Microphone - always available */}
            <div className="h-6 p-1 flex items-center justify-center rounded-sm hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out gap-1">
              <IconMicrophone size={18} className="text-main-view-fg/50" />
            </div>

            {selectedModel?.capabilities?.includes('vision') && (
              <div className="h-6 p-1 flex items-center justify-center rounded-sm hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out gap-1">
                <IconEye size={18} className="text-main-view-fg/50" />
              </div>
            )}

            {selectedModel?.capabilities?.includes('embeddings') && (
              <div className="h-6 p-1 flex items-center justify-center rounded-sm hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out gap-1">
                <IconCodeCircle2 size={18} className="text-main-view-fg/50" />
              </div>
            )}

            {selectedModel?.capabilities?.includes('tools') && (
              <div className="h-6 p-1 flex items-center justify-center rounded-sm hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out gap-1">
                <IconTool size={18} className="text-main-view-fg/50" />
              </div>
            )}

            {selectedModel?.capabilities?.includes('web_search') && (
              <div className="h-6 p-1 flex items-center justify-center rounded-sm hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out gap-1">
                <IconWorld size={18} className="text-main-view-fg/50" />
              </div>
            )}

            {selectedModel?.capabilities?.includes('reasoning') && (
              <div className="h-6 p-1 flex items-center justify-center rounded-sm hover:bg-main-view-fg/10 transition-all duration-200 ease-in-out gap-1">
                <IconAtom size={18} className="text-main-view-fg/50" />
              </div>
            )}
          </div>
          <Button
            variant={!prompt ? null : 'default'}
            size="icon"
            disabled={!prompt}
            onClick={sendMessage}
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
