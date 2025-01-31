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
    <div className="mx-auto w-full max-w-2xl">
      <div className="mb-4 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-4">
        <div className="mb-2 flex items-center gap-3">
          {loading && <Loader className="animate-spin h-4 w-4 text-blue-500" />}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-2 text-gray-700 hover:text-gray-900 focus:outline-none"
          >
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
            <span className="font-medium">Reasoning Process</span>
          </button>
        </div>

        {isExpanded && (
          <div className="mt-2 pl-6 text-gray-600">
            {text.replace(/<\/?think>/g, '').trim()}
          </div>
        )}
      </div>
    </div>
  )
}
export default ThinkingBlock
