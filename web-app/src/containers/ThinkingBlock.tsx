import { ChevronDown, ChevronUp, Loader } from 'lucide-react'
import { create } from 'zustand'
import { RenderMarkdown } from './RenderMarkdown'
import { useAppState } from '@/hooks/useAppState'
import { useTranslation } from '@/i18n/react-i18next-compat'

interface Props {
  text: string
  id: string
}

// Zustand store for thinking block state
type ThinkingBlockState = {
  thinkingState: { [id: string]: boolean }
  toggleState: (id: string) => void
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
  const { streamingContent } = useAppState()
  const { t } = useTranslation()
  const loading = !text.includes('</think>') && streamingContent
  const isExpanded = thinkingState[id] ?? false
  const handleClick = () => toggleState(id)

  if (!text.replace(/<\/?think>/g, '').trim()) return null

  return (
    <div
      className="mx-auto w-full cursor-pointer break-words"
      onClick={handleClick}
    >
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
              {loading ? t('common:thinking') : t('common:thought')}
            </span>
          </button>
        </div>

        {isExpanded && (
          <div className="mt-2 pl-6 pr-4 text-main-view-fg/60">
            <RenderMarkdown content={text.replace(/<\/?think>/g, '').trim()} />
          </div>
        )}
      </div>
    </div>
  )
}

export default ThinkingBlock
