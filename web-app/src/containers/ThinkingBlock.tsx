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
  const loading = !text.includes('</think>')
  const isExpanded = thinkingState[id] ?? false
  const handleClick = () => toggleState(id)

  if (!text.replace(/<\/?think>/g, '').trim()) return null

  return (
    <div className="mx-auto w-full cursor-pointer" onClick={handleClick}>
      <div className="mb-4 rounded-lg bg-main-view-fg/4 border border-dashed border-main-view-fg/10 p-2">
        <div className="flex items-center gap-3">
          {loading && (
            <Loader className="size-4 animate-spin text-main-view-fg/60" />
          )}
          <button className="flex items-center gap-2 focus:outline-none">
            {isExpanded ? (
              <ChevronUp className="size-4 text-main-view-fg/60" />
            ) : (
              <ChevronDown className="size-4 text-main-view-fg/60" />
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
