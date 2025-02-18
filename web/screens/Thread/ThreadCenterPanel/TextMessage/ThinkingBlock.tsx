import React from 'react'

import { atom, useAtom } from 'jotai'
import { ChevronDown, ChevronUp, Loader } from 'lucide-react'

import { MarkdownTextMessage } from './MarkdownTextMessage'

interface Props {
  text: string
  status: string
  id: number
}

const thinkingBlockStateAtom = atom<{ [id: number]: boolean }>({})

const ThinkingBlock = ({ id, text, status }: Props) => {
  const [thinkingState, setThinkingState] = useAtom(thinkingBlockStateAtom)

  const isExpanded = thinkingState[id] ?? false

  const loading = !text.includes('</think>') && status === 'pending'

  const handleClick = () => {
    setThinkingState((prev) => ({ ...prev, [id]: !isExpanded }))
  }

  if (!text.replace(/<\/?think>/g, '').trim()) return null

  return (
    <div className="mx-auto w-full">
      <div className="mb-4 rounded-lg border border-dashed border-[hsla(var(--app-border))] p-2">
        <div
          className="flex cursor-pointer items-center gap-3"
          onClick={handleClick}
        >
          {loading && (
            <Loader className="h-4 w-4 animate-spin text-[hsla(var(--primary-bg))]" />
          )}
          <button className="flex items-center gap-2 focus:outline-none">
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
            <span className="font-medium">
              {loading ? 'Thinking...' : 'Thought'}
            </span>
          </button>
        </div>

        {isExpanded && (
          <div className="mt-2 pl-6 text-[hsla(var(--text-secondary))]">
            <MarkdownTextMessage
              text={text.replace(/<\/?think>/g, '').trim()}
            />
          </div>
        )}
      </div>
    </div>
  )
}

export default ThinkingBlock
