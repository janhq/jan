import React from 'react'

import { atom, useAtom } from 'jotai'
import { ChevronDown, ChevronUp, Loader } from 'lucide-react'

import { MarkdownTextMessage } from './MarkdownTextMessage'

interface Props {
  result: string
  name: string
  id: number
  loading: boolean
}

const toolCallBlockStateAtom = atom<{ [id: number]: boolean }>({})

const ToolCallBlock = ({ id, name, result, loading }: Props) => {
  const [collapseState, setCollapseState] = useAtom(toolCallBlockStateAtom)

  const isExpanded = collapseState[id] ?? false
  const handleClick = () => {
    setCollapseState((prev) => ({ ...prev, [id]: !isExpanded }))
  }
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
              {' '}
              View result from <span className="font-bold">{name}</span>
            </span>
          </button>
        </div>

        {isExpanded && (
          <div className="mt-2 overflow-x-hidden pl-6 text-[hsla(var(--text-secondary))]">
            <span>{result ?? ''} </span>
          </div>
        )}
      </div>
    </div>
  )
}

export default ToolCallBlock
