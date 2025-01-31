import React, { useState } from 'react'

import { ChevronDown, ChevronUp, Loader } from 'lucide-react'

interface Props {
  text: string
}
const ThinkingBlock = ({ text }: Props) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const loading = !text.includes('</think>')

  if (!text.replace(/<\/?think>/g, '').trim()) return null

  return (
    <div className="mx-auto w-full">
      <div className="mb-4 rounded-lg border border-dashed border-[hsla(var(--app-border))] p-2">
        <div
          className="flex cursor-pointer items-center gap-3"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {loading && (
            <Loader className="animate-spin h-4 w-4 text-[hsla(var(--bg-primary))]" />
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
            {text.replace(/<\/?think>/g, '').trim()}
          </div>
        )}
      </div>
    </div>
  )
}
export default ThinkingBlock
