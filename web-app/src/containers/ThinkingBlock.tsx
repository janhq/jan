import { ChevronDown, ChevronUp, Loader } from 'lucide-react'
import { create } from 'zustand'
import { RenderMarkdown } from './RenderMarkdown'
import { useAppState } from '@/hooks/useAppState'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { extractThinkingContent } from '@/lib/utils'

interface Props {
  text: string
  id: string
}

// Zustand store for thinking block state
type ThinkingBlockState = {
  thinkingState: { [id: string]: boolean }
  setThinkingState: (id: string, expanded: boolean) => void
}

const useThinkingStore = create<ThinkingBlockState>((set) => ({
  thinkingState: {},
  setThinkingState: (id, expanded) =>
    set((state) => ({
      thinkingState: {
        ...state.thinkingState,
        [id]: expanded,
      },
    })),
}))

const ThinkingBlock = ({ id, text }: Props) => {
  const thinkingState = useThinkingStore((state) => state.thinkingState)
  const setThinkingState = useThinkingStore((state) => state.setThinkingState)
  const isStreaming = useAppState((state) => !!state.streamingContent)
  const { t } = useTranslation()
  // Check for thinking formats
  const hasThinkTag = text.includes('<think>') && !text.includes('</think>')
  const hasAnalysisChannel =
    text.includes('<|channel|>analysis<|message|>') &&
    !text.includes('<|start|>assistant<|channel|>final<|message|>')
  const loading = (hasThinkTag || hasAnalysisChannel) && isStreaming
  const isExpanded = thinkingState[id] ?? (loading ? true : false)
  const handleClick = () => {
    const newExpandedState = !isExpanded
    setThinkingState(id, newExpandedState)
  }

  const thinkingContent = extractThinkingContent(text)
  if (!thinkingContent) return null

  return (
    <div
      className="mx-auto w-full cursor-pointer break-words"
      onClick={handleClick}
    >
      <div className="mb-4 rounded-lg bg-main-view-fg/4 border border-dotted border-main-view-fg/10 p-2">
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
              {loading ? t('common:thinking') : t('common:thought')}
            </span>
          </button>
        </div>

        {isExpanded && (
          <div className="mt-2 pl-6 pr-4 text-main-view-fg/60">
            <RenderMarkdown content={thinkingContent} />
          </div>
        )}
      </div>
    </div>
  )
}

export default ThinkingBlock
