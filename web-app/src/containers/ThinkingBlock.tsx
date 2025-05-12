import { ChevronDown, ChevronUp, Loader } from 'lucide-react'
import { create } from 'zustand'
import { RenderMarkdown } from './RenderMarkdown'

interface Props {
  text: string
  id: number
}

// Zustand store for thinking block state
type ThinkingBlockState = {
  thinkingState: { [id: number]: boolean }
  toggleState: (id: number) => void
}

const useThinkingStore = create<ThinkingBlockState>((set) => ({
  thinkingState: {},
  toggleState: (id) =>
    set((state) => ({
      thinkingState: {
        ...state.thinkingState,
        [id]: !state.thinkingState[id],
      },
    })),
}))

const ThinkingBlock = ({ id, text }: Props) => {
  const { thinkingState, toggleState } = useThinkingStore()
  const isExpanded = thinkingState[id] ?? false
  const loading = !text.includes('</think>')
  const handleClick = () => toggleState(id)

  if (!text.replace(/<\/?think>/g, '').trim()) return null

  return (
    <div className="mx-auto w-full">
      <div className="mb-4 rounded-lg border border-dashed border-main-view-fg/10 p-2">
        <div
          className="flex cursor-pointer items-center gap-3"
          onClick={handleClick}
        >
          {loading && (
            <Loader className="h-4 w-4 animate-spin text-main-view-fg/60]" />
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
          <div className="mt-2 pl-6 text-main-view-fg/60">
            <RenderMarkdown content={text.replace(/<\/?think>/g, '').trim()} />
          </div>
        )}
      </div>
    </div>
  )
}

export default ThinkingBlock
